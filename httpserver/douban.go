package main

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

type doubanBookResult struct {
	Code  int                 `json:"code"`
	Books []metadataCandidate `json:"books"`
	Msg   string              `json:"msg"`
}

type doubanBookDetail struct {
	ID     string   `json:"id"`
	Author []string `json:"author"`
	Images struct {
		Large string `json:"large"`
	} `json:"images"`
	Publisher string `json:"publisher"`
	Summary   string `json:"summary"`
	Title     string `json:"title"`
	ISBN13    string `json:"isbn13"`
	Pubdate   string `json:"pubdate"`
	Pages     string `json:"pages"`
	Price     string `json:"price"`
	Binding   string `json:"binding"`
	Rating    struct {
		Average float64 `json:"average"`
	} `json:"rating"`
}

type doubanCacheEntry struct {
	expiresAt time.Time
	value     metadataCandidate
}

var (
	doubanBookSearchData    = regexp.MustCompile(`(?s)window\.__DATA__\s*=\s*(\{.*?\});\s*window\.__USER__`)
	doubanSearchResultRegex = regexp.MustCompile(`(?s)<div class="result".*?<div class="title">.*?<a[^>]*onclick="([^"]+)"[^>]*>(.*?)</a>.*?</div>.*?<div class="subject-cast">(.*?)</div>.*?<div class="rating_nums">(.*?)</div>.*?<div class="pic">.*?<img[^>]*src="([^"]+)"`)
	doubanSearchIDRegex     = regexp.MustCompile(`sid:\s*(\d+)`)
	doubanBookTitleRegex    = regexp.MustCompile(`(?s)<h1[^>]*>.*?<span[^>]*property="v:itemreviewed"[^>]*>(.*?)</span>.*?</h1>`)
	doubanBookLargeImage    = regexp.MustCompile(`(?s)<a class="nbg"[^>]*href="([^"]+)"`)
	doubanBookSmallImage    = regexp.MustCompile(`(?s)<a class="nbg"[^>]*>.*?<img[^>]*src="([^"]+)"`)
	doubanBookRatingRegex   = regexp.MustCompile(`(?s)<strong[^>]*class="[^"]*rating_num[^"]*"[^>]*property="v:average"[^>]*>(.*?)</strong>`)
	doubanBookSummaryRegex  = regexp.MustCompile(`(?s)<div class="indent" id="link-report">.*?<span class="all hidden">(.*?)</span>`)
	doubanBookSummaryAlt    = regexp.MustCompile(`(?s)<div class="indent" id="link-report">.*?<span[^>]*property="v:summary"[^>]*>(.*?)</span>`)
	doubanBookSummaryIntro  = regexp.MustCompile(`(?s)<div class="indent" id="link-report">.*?<div class="intro">(.*?)</div>`)
	doubanBookInfoRegex     = regexp.MustCompile(`(?s)<div id="info"[^>]*>(.*?)</div>`)
	doubanBookTagsSection   = regexp.MustCompile(`(?s)<div[^>]*id="db-tags-section"[^>]*>(.*?)</div>`)
	doubanBookTagLink       = regexp.MustCompile(`(?s)<a[^>]*href="(?:https?://book\\.douban\\.com)?/tag/[^"]*"[^>]*>(.*?)</a>`)
	doubanBookTagStripper   = regexp.MustCompile(`(?s)<[^>]+>`)
	doubanBookInfoPair      = regexp.MustCompile(`([^\n:：]+)[:：]\s*([^\n]+)`)
	doubanBookSlashCleaner  = regexp.MustCompile(`\s*/\s*`)
	doubanBookCache         = map[string]doubanCacheEntry{}
	doubanBookCacheMutex    sync.RWMutex
)

func fetchMetadataCandidates(name, author string) ([]metadataCandidate, error) {
	name = strings.TrimSpace(name)
	author = strings.TrimSpace(author)

	querySet := []string{}
	seen := map[string]struct{}{}
	addQuery := func(parts ...string) {
		query := strings.TrimSpace(strings.Join(parts, " "))
		if query == "" {
			return
		}
		if _, ok := seen[query]; ok {
			return
		}
		seen[query] = struct{}{}
		querySet = append(querySet, query)
	}

	cleanName := sanitizeMetadataKeyword(name)
	cleanAuthor := sanitizeMetadataKeyword(author)

	addQuery(name, author)
	addQuery(cleanName, cleanAuthor)
	addQuery(name)
	addQuery(cleanName)

	for _, query := range querySet {
		if results, err := searchDoubanBooks(query, 10); err == nil && len(results) > 0 {
			return rankMetadataCandidates(results, cleanName, cleanAuthor), nil
		}
	}

	results, err := fetchOpenLibraryCandidates(cleanName, cleanAuthor)
	if err != nil {
		return []metadataCandidate{}, err
	}
	return rankMetadataCandidates(results, cleanName, cleanAuthor), nil
}

func fetchMetadataBySource(source, key string) (metadataCandidate, error) {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "douban":
		return getDoubanBookByID(key)
	case "open library", "open-library", "openlibrary":
		return metadataCandidate{}, fmt.Errorf("unsupported metadata source detail: %s", source)
	default:
		return metadataCandidate{}, fmt.Errorf("unsupported metadata source: %s", source)
	}
}

func searchDoubanBooks(query string, count int) ([]metadataCandidate, error) {
	if query == "" {
		return []metadataCandidate{}, nil
	}
	if count <= 0 {
		count = 10
	}
	if count > 20 {
		count = 20
	}

	client := &http.Client{Timeout: 15 * time.Second}
	endpoint := "https://search.douban.com/book/subject_search?search_text=" + urlQueryEscape(query) + "&cat=1001"
	resp, err := newDoubanRequest(client, endpoint)
	if err != nil {
		return searchDoubanBooksLegacy(client, query, count)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	htmlText := string(body)
	results := parseDoubanSubjectSearchData(htmlText, count)
	if len(results) > 0 {
		return results, nil
	}
	return searchDoubanBooksLegacy(client, query, count)
}

func parseDoubanSubjectSearchData(htmlText string, count int) []metadataCandidate {
	match := doubanBookSearchData.FindStringSubmatch(htmlText)
	if len(match) < 2 {
		return []metadataCandidate{}
	}
	var payload struct {
		Items []struct {
			ID       int64  `json:"id"`
			Title    string `json:"title"`
			URL      string `json:"url"`
			Abstract string `json:"abstract"`
			CoverURL string `json:"cover_url"`
			TplName  string `json:"tpl_name"`
			Rating   struct {
				Value float64 `json:"value"`
			} `json:"rating"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(match[1]), &payload); err != nil {
		return []metadataCandidate{}
	}

	results := make([]metadataCandidate, 0, len(payload.Items))
	for _, item := range payload.Items {
		if item.TplName != "search_subject" || item.ID == 0 {
			continue
		}
		authors, publisher, pubdate := parseSubjectCast(item.Abstract)
		rating := ""
		if item.Rating.Value > 0 {
			rating = fmt.Sprintf("%.1f", item.Rating.Value)
		}
		id := fmt.Sprintf("%d", item.ID)
		sourceURL := strings.TrimSpace(item.URL)
		if sourceURL == "" {
			sourceURL = "https://book.douban.com/subject/" + id + "/"
		}
		results = append(results, metadataCandidate{
			Key:         id,
			Name:        strings.TrimSpace(item.Title),
			Author:      strings.Join(authors, ", "),
			Publisher:   publisher,
			Description: "",
			Cover:       strings.TrimSpace(item.CoverURL),
			ISBN:        "",
			DoubanID:    id,
			PublishedAt: pubdate,
			Rating:      rating,
			Source:      "Douban",
			SourceURL:   sourceURL,
		})
		if len(results) >= count {
			break
		}
	}
	return results
}

func searchDoubanBooksLegacy(client *http.Client, query string, count int) ([]metadataCandidate, error) {
	endpoint := "https://www.douban.com/search?cat=1001&q=" + urlQueryEscape(query)
	resp, err := newDoubanRequest(client, endpoint)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	htmlText := string(body)
	matches := doubanSearchResultRegex.FindAllStringSubmatch(htmlText, count)
	results := make([]metadataCandidate, 0, len(matches))
	for _, match := range matches {
		idMatch := doubanSearchIDRegex.FindStringSubmatch(match[1])
		if len(idMatch) < 2 {
			continue
		}
		title := cleanHTMLText(match[2])
		authors, publisher, pubdate := parseSubjectCast(match[3])
		rating := strings.TrimSpace(cleanHTMLText(match[4]))
		cover := strings.TrimSpace(match[5])
		results = append(results, metadataCandidate{
			Key:         idMatch[1],
			Name:        title,
			Author:      strings.Join(authors, ", "),
			Publisher:   publisher,
			Description: "",
			Cover:       cover,
			ISBN:        "",
			DoubanID:    idMatch[1],
			PublishedAt: pubdate,
			Rating:      rating,
			Source:      "Douban",
			SourceURL:   "https://book.douban.com/subject/" + idMatch[1] + "/",
		})
	}
	return results, nil
}

func getDoubanBookByID(id string) (metadataCandidate, error) {
	cacheKey := "douban:id:" + strings.TrimSpace(id)
	if cached, ok := getDoubanCached(cacheKey); ok {
		return cached, nil
	}
	if strings.TrimSpace(id) == "" {
		return metadataCandidate{}, fmt.Errorf("empty douban id")
	}
	client := &http.Client{Timeout: 15 * time.Second}
	endpoint := "https://book.douban.com/subject/" + urlQueryEscape(id) + "/"
	resp, err := newDoubanRequest(client, endpoint)
	if err != nil {
		return metadataCandidate{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return metadataCandidate{}, err
	}
	result := parseDoubanBookDetailHTML(id, string(body))
	putDoubanCached(cacheKey, result)
	if result.ISBN != "" {
		putDoubanCached("douban:isbn:"+result.ISBN, result)
	}
	return result, nil
}

func getDoubanBookByISBN(isbn string) (metadataCandidate, error) {
	isbn = strings.TrimSpace(isbn)
	if isbn == "" {
		return metadataCandidate{}, fmt.Errorf("empty isbn")
	}
	cacheKey := "douban:isbn:" + isbn
	if cached, ok := getDoubanCached(cacheKey); ok {
		return cached, nil
	}
	client := &http.Client{Timeout: 15 * time.Second}
	endpoint := "https://douban.com/isbn/" + urlQueryEscape(isbn) + "/"
	resp, err := newDoubanRequest(client, endpoint)
	if err != nil {
		return metadataCandidate{}, err
	}
	defer resp.Body.Close()

	finalURL := resp.Request.URL.String()
	id := parseDoubanIDFromURL(finalURL)
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return metadataCandidate{}, err
	}
	result := parseDoubanBookDetailHTML(id, string(body))
	if result.ISBN == "" {
		result.ISBN = isbn
	}
	if result.DoubanID == "" {
		result.DoubanID = id
	}
	if result.Key == "" {
		result.Key = id
	}
	putDoubanCached(cacheKey, result)
	if result.DoubanID != "" {
		putDoubanCached("douban:id:"+result.DoubanID, result)
	}
	return result, nil
}

func newDoubanRequest(client *http.Client, endpoint string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://book.douban.com/")
	req.Header.Set("Origin", "https://book.douban.com")
	if cookie := strings.TrimSpace(os.Getenv("DOUBAN_COOKIE")); cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, fmt.Errorf("douban request failed: %s", resp.Status)
	}
	return resp, nil
}

func parseSubjectCast(raw string) ([]string, string, string) {
	cleaned := cleanHTMLText(raw)
	parts := strings.Split(cleaned, "/")
	trimmed := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			trimmed = append(trimmed, part)
		}
	}
	if len(trimmed) >= 4 && isLikelyPrice(trimmed[len(trimmed)-1]) {
		trimmed = trimmed[:len(trimmed)-1]
	}
	if len(trimmed) == 0 {
		return []string{}, "", ""
	}
	if len(trimmed) == 1 {
		return []string{trimmed[0]}, "", ""
	}
	if len(trimmed) == 2 {
		if isLikelyPubdate(trimmed[1]) {
			return []string{trimmed[0]}, "", trimmed[1]
		}
		return []string{trimmed[0]}, trimmed[1], ""
	}
	authors := trimmed[:len(trimmed)-2]
	publisher := trimmed[len(trimmed)-2]
	pubdate := trimmed[len(trimmed)-1]
	return authors, publisher, pubdate
}

func parseDoubanBookDetailHTML(id string, body string) metadataCandidate {
	title := firstSubmatch(doubanBookTitleRegex, body)
	largeCover := firstSubmatch(doubanBookLargeImage, body)
	if largeCover == "" {
		largeCover = firstSubmatch(doubanBookSmallImage, body)
	}
	rating := strings.TrimSpace(cleanHTMLText(firstSubmatch(doubanBookRatingRegex, body)))
	summary := firstSubmatch(doubanBookSummaryRegex, body)
	if summary == "" {
		summary = firstSubmatch(doubanBookSummaryAlt, body)
	}
	if summary == "" {
		summary = firstSubmatch(doubanBookSummaryIntro, body)
	}
	summary = cleanHTMLContent(summary)
	infoHTML := firstSubmatch(doubanBookInfoRegex, body)
	infoText := normalizeInfoText(infoHTML)
	infoMap := map[string]string{}
	for _, match := range doubanBookInfoPair.FindAllStringSubmatch(infoText, -1) {
		key := strings.TrimSpace(match[1])
		value := strings.TrimSpace(match[2])
		if key != "" && value != "" {
			infoMap[key] = doubanBookSlashCleaner.ReplaceAllString(value, " / ")
		}
	}

	isbn := pickInfoValue(infoMap, "ISBN")
	author := pickInfoValue(infoMap, "作者")
	publisher := pickInfoValue(infoMap, "出版社")
	pubdate := pickInfoValue(infoMap, "出版年")
	if pubdate == "" {
		pubdate = pickInfoValue(infoMap, "出版时间")
	}
	tags := extractDoubanTags(body)

	return metadataCandidate{
		Key:         id,
		Name:        title,
		Author:      author,
		Publisher:   publisher,
		Description: summary,
		Cover:       largeCover,
		ISBN:        isbn,
		DoubanID:    id,
		Tags:        strings.Join(tags, ", "),
		PublishedAt: pubdate,
		Rating:      rating,
		Source:      "Douban",
		SourceURL:   "https://book.douban.com/subject/" + id + "/",
	}
}

func fetchOpenLibraryCandidates(name, author string) ([]metadataCandidate, error) {
	client := &http.Client{Timeout: 12 * time.Second}
	openLibraryEndpoint := "https://openlibrary.org/search.json?title=" + urlQueryEscape(name) + "&author=" + urlQueryEscape(author) + "&limit=10"
	resp, err := client.Get(openLibraryEndpoint)
	if err != nil {
		return []metadataCandidate{}, nil
	}
	defer resp.Body.Close()

	var openPayload struct {
		Docs []struct {
			Key              string   `json:"key"`
			Title            string   `json:"title"`
			AuthorName       []string `json:"author_name"`
			Publisher        []string `json:"publisher"`
			FirstPublishYear int      `json:"first_publish_year"`
			ISBN             []string `json:"isbn"`
			CoverI           int      `json:"cover_i"`
		} `json:"docs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&openPayload); err != nil {
		return []metadataCandidate{}, nil
	}

	results := make([]metadataCandidate, 0, len(openPayload.Docs))
	for _, item := range openPayload.Docs {
		cover := ""
		if item.CoverI > 0 {
			cover = fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-L.jpg", item.CoverI)
		}
		publisher := ""
		if len(item.Publisher) > 0 {
			publisher = item.Publisher[0]
		}
		isbn := ""
		if len(item.ISBN) > 0 {
			isbn = item.ISBN[0]
		}
		publishedAt := ""
		if item.FirstPublishYear > 0 {
			publishedAt = fmt.Sprintf("%d", item.FirstPublishYear)
		}
		results = append(results, metadataCandidate{
			Key:         item.Key,
			Name:        item.Title,
			Author:      strings.Join(item.AuthorName, ", "),
			Publisher:   publisher,
			Description: "",
			Cover:       cover,
			ISBN:        isbn,
			PublishedAt: publishedAt,
			Source:      "Open Library",
			SourceURL:   "https://openlibrary.org" + item.Key,
		})
	}
	return results, nil
}

func getDoubanCached(key string) (metadataCandidate, bool) {
	doubanBookCacheMutex.RLock()
	entry, ok := doubanBookCache[key]
	doubanBookCacheMutex.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return metadataCandidate{}, false
	}
	return entry.value, true
}

func putDoubanCached(key string, value metadataCandidate) {
	if key == "" {
		return
	}
	doubanBookCacheMutex.Lock()
	doubanBookCache[key] = doubanCacheEntry{
		expiresAt: time.Now().Add(10 * time.Minute),
		value:     value,
	}
	doubanBookCacheMutex.Unlock()
}

func parseDoubanIDFromURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parts := strings.Split(strings.TrimSuffix(value, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[len(parts)-1])
}

func firstSubmatch(re *regexp.Regexp, source string) string {
	match := re.FindStringSubmatch(source)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

func cleanHTMLText(value string) string {
	value = doubanBookTagStripper.ReplaceAllString(value, " ")
	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, "\u00a0", " ")
	return strings.Join(strings.Fields(value), " ")
}

func cleanHTMLContent(value string) string {
	value = strings.ReplaceAll(value, "<br/>", "\n")
	value = strings.ReplaceAll(value, "<br />", "\n")
	value = strings.ReplaceAll(value, "<br>", "\n")
	value = doubanBookTagStripper.ReplaceAllString(value, "")
	value = html.UnescapeString(value)
	lines := strings.Split(value, "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(strings.ReplaceAll(line, "\u00a0", " "))
		if line != "" {
			cleaned = append(cleaned, line)
		}
	}
	return strings.Join(cleaned, "\n")
}

func normalizeInfoText(value string) string {
	value = strings.ReplaceAll(value, "<br/>", "\n")
	value = strings.ReplaceAll(value, "<br />", "\n")
	value = strings.ReplaceAll(value, "<br>", "\n")
	value = doubanBookTagStripper.ReplaceAllString(value, "")
	value = html.UnescapeString(value)
	lines := strings.Split(value, "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(strings.ReplaceAll(line, "\u00a0", " "))
		if line != "" {
			cleaned = append(cleaned, line)
		}
	}
	return strings.Join(cleaned, "\n")
}

func extractDoubanTags(body string) []string {
	section := firstSubmatch(doubanBookTagsSection, body)
	if section == "" {
		return []string{}
	}
	matches := doubanBookTagLink.FindAllStringSubmatch(section, -1)
	if len(matches) == 0 {
		return []string{}
	}
	tags := make([]string, 0, len(matches))
	seen := map[string]struct{}{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		tag := cleanHTMLText(match[1])
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}
	return tags
}

func pickInfoValue(values map[string]string, key string) string {
	return strings.TrimSpace(values[key])
}

func isLikelyPubdate(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	if len(value) >= 4 && value[0] >= '0' && value[0] <= '9' {
		return true
	}
	return strings.Contains(value, "-")
}

func isLikelyPrice(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	return strings.Contains(value, "元") ||
		strings.Contains(strings.ToLower(value), "cny") ||
		strings.Contains(value, "￥") ||
		strings.Contains(value, "$")
}

func sanitizeMetadataKeyword(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	replacer := strings.NewReplacer(
		"（", "(",
		"）", ")",
		"【", "[",
		"】", "]",
		"《", " ",
		"》", " ",
		"：", ":",
		"·", " ",
		"（套装）", " ",
		"(套装)", " ",
		"套装", " ",
	)
	value = replacer.Replace(value)
	for _, sep := range []string{":", "(", "[", "（", "【", "-", "_", "|", "/"} {
		if idx := strings.Index(value, sep); idx > 0 {
			value = value[:idx]
			break
		}
	}
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func scoreMetadataCandidate(item metadataCandidate, name, author string) int {
	score := 0
	itemName := strings.ToLower(sanitizeMetadataKeyword(item.Name))
	itemAuthor := strings.ToLower(sanitizeMetadataKeyword(item.Author))
	name = strings.ToLower(sanitizeMetadataKeyword(name))
	author = strings.ToLower(sanitizeMetadataKeyword(author))

	if name != "" {
		switch {
		case itemName == name:
			score += 120
		case strings.Contains(itemName, name):
			score += 80
		case strings.Contains(name, itemName):
			score += 50
		}
	}
	if author != "" {
		switch {
		case itemAuthor == author:
			score += 60
		case strings.Contains(itemAuthor, author):
			score += 40
		case strings.Contains(author, itemAuthor):
			score += 20
		}
	}
	if item.Source == "Douban" {
		score += 10
	}
	if item.Rating != "" {
		score += 5
	}
	if item.Cover != "" {
		score += 5
	}
	return score
}

func rankMetadataCandidates(items []metadataCandidate, name, author string) []metadataCandidate {
	if len(items) < 2 {
		return items
	}
	ranked := append([]metadataCandidate(nil), items...)
	slices.SortStableFunc(ranked, func(a, b metadataCandidate) int {
		return scoreMetadataCandidate(b, name, author) - scoreMetadataCandidate(a, name, author)
	})
	return ranked
}
