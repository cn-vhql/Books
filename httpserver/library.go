package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var libraryEnabled bool

func init() {
	libraryEnabled = getEnv("ENABLE_LIBRARY_SERVER", "true") != "false"
}

type libraryBook struct {
	Key          string `json:"key"`
	Name         string `json:"name"`
	Author       string `json:"author"`
	Description  string `json:"description"`
	MD5          string `json:"md5"`
	Cover        string `json:"cover"`
	Format       string `json:"format"`
	Publisher    string `json:"publisher"`
	Size         int64  `json:"size"`
	Page         int    `json:"page"`
	Path         string `json:"path"`
	Charset      string `json:"charset"`
	ISBN         string `json:"isbn,omitempty"`
	DoubanID     string `json:"doubanId,omitempty"`
	Tags         string `json:"tags,omitempty"`
	Series       string `json:"series,omitempty"`
	PublishedAt  string `json:"publishedAt,omitempty"`
	Source       string `json:"source,omitempty"`
	SourceURL    string `json:"sourceUrl,omitempty"`
	Rating       string `json:"rating,omitempty"`
	VisibleToAll bool   `json:"visibleToAll,omitempty"`
	Owner        string `json:"owner,omitempty"`
}

type libraryUser struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	Enabled   bool   `json:"enabled"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type authenticatedUser struct {
	ID       int64
	Username string
	Role     string
	Enabled  bool
}

type librarySession struct {
	Token     string
	UserID    int64
	Username  string
	Role      string
	ExpiresAt int64
}

type metadataCandidate struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Author      string `json:"author"`
	Publisher   string `json:"publisher"`
	Description string `json:"description"`
	Cover       string `json:"cover"`
	ISBN        string `json:"isbn"`
	DoubanID    string `json:"doubanId"`
	PublishedAt string `json:"publishedAt"`
	Rating      string `json:"rating"`
	Source      string `json:"source"`
	SourceURL   string `json:"sourceUrl"`
}

type metadataDetailResponse struct {
	Code int               `json:"code"`
	Data metadataCandidate `json:"data"`
}

type pagedBooksResponse struct {
	Items    []libraryBook `json:"items"`
	Total    int           `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"pageSize"`
}

type recordFilter struct {
	userID int64
	role   string
}

var allowedRecordTypes = map[string]bool{
	"notes":            true,
	"bookmarks":        true,
	"record_locations": true,
}

const sessionCookieName = "koodo_session"

func openLibraryDB() (*sql.DB, error) {
	dbPath := filepath.Join(uploadDir, "config", "library.db")
	return sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
}

func ensureLibrarySchema() error {
	if err := os.MkdirAll(filepath.Join(uploadDir, "config"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(uploadDir, "book"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(uploadDir, "cover"), 0o755); err != nil {
		return err
	}

	booksDB, err := openBooksDB()
	if err != nil {
		return err
	}
	defer booksDB.Close()

	bookStatements := []string{
		`CREATE TABLE IF NOT EXISTS books (
			key TEXT PRIMARY KEY,
			name TEXT,
			author TEXT,
			description TEXT,
			md5 TEXT,
			cover TEXT,
			format TEXT,
			publisher TEXT,
			size INTEGER,
			page INTEGER,
			path TEXT,
			charset TEXT
		)`,
		`ALTER TABLE books ADD COLUMN isbn TEXT`,
		`ALTER TABLE books ADD COLUMN douban_id TEXT`,
		`ALTER TABLE books ADD COLUMN tags TEXT`,
		`ALTER TABLE books ADD COLUMN series TEXT`,
		`ALTER TABLE books ADD COLUMN published_at TEXT`,
		`ALTER TABLE books ADD COLUMN source TEXT`,
		`ALTER TABLE books ADD COLUMN source_url TEXT`,
		`ALTER TABLE books ADD COLUMN rating TEXT`,
		`ALTER TABLE books ADD COLUMN owner_user_id INTEGER DEFAULT 1`,
		`ALTER TABLE books ADD COLUMN visible_to_all INTEGER DEFAULT 1`,
	}
	for _, stmt := range bookStatements {
		if _, err := booksDB.Exec(stmt); err != nil && !isDuplicateColumnError(err) {
			return err
		}
	}

	db, err := openLibraryDB()
	if err != nil {
		return err
	}
	defer db.Close()

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			enabled INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS book_access (
			book_key TEXT NOT NULL,
			user_id INTEGER NOT NULL,
			PRIMARY KEY (book_key, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS notes (
			user_id INTEGER NOT NULL DEFAULT 1,
			key TEXT NOT NULL,
			bookKey TEXT NOT NULL,
			chapter TEXT,
			chapterIndex INTEGER,
			text TEXT,
			cfi TEXT,
			range TEXT,
			notes TEXT,
			date TEXT,
			percentage TEXT,
			color TEXT,
			tag TEXT,
			PRIMARY KEY (user_id, key)
		)`,
		`CREATE TABLE IF NOT EXISTS bookmarks (
			user_id INTEGER NOT NULL DEFAULT 1,
			key TEXT NOT NULL,
			bookKey TEXT NOT NULL,
			cfi TEXT,
			label TEXT,
			percentage TEXT,
			chapter TEXT,
			PRIMARY KEY (user_id, key)
		)`,
		`CREATE TABLE IF NOT EXISTS record_locations (
			user_id INTEGER NOT NULL DEFAULT 1,
			bookKey TEXT NOT NULL,
			payload TEXT NOT NULL,
			percentage TEXT,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, bookKey)
		)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}

	if err := migrateLegacyUserScopedTables(db); err != nil {
		return err
	}
	indexStmts := []string{
		`CREATE INDEX IF NOT EXISTS idx_notes_book_key ON notes(bookKey)`,
		`CREATE INDEX IF NOT EXISTS idx_notes_user_key ON notes(user_id, bookKey)`,
		`CREATE INDEX IF NOT EXISTS idx_bookmarks_book_key ON bookmarks(bookKey)`,
		`CREATE INDEX IF NOT EXISTS idx_bookmarks_user_key ON bookmarks(user_id, bookKey)`,
		`CREATE INDEX IF NOT EXISTS idx_record_locations_user_key ON record_locations(user_id, bookKey)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_book_access_user_id ON book_access(user_id, book_key)`,
	}
	for _, stmt := range indexStmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	if err := seedDefaultAdmin(db); err != nil {
		return err
	}
	if err := ensureExistingBooksOwnership(booksDB); err != nil {
		return err
	}
	return nil
}

func isDuplicateColumnError(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate column")
}

func migrateLegacyUserScopedTables(db *sql.DB) error {
	notesHasUser, err := tableHasColumn(db, "notes", "user_id")
	if err != nil {
		return err
	}
	if !notesHasUser {
		if err := recreateNotesTableWithUserID(db); err != nil {
			return err
		}
	}

	bookmarksHasUser, err := tableHasColumn(db, "bookmarks", "user_id")
	if err != nil {
		return err
	}
	if !bookmarksHasUser {
		if err := recreateBookmarksTableWithUserID(db); err != nil {
			return err
		}
	}

	recordHasUser, err := tableHasColumn(db, "record_locations", "user_id")
	if err != nil {
		return err
	}
	if !recordHasUser {
		if err := recreateRecordLocationsTableWithUserID(db); err != nil {
			return err
		}
	}

	return nil
}

func tableHasColumn(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var ctype string
		var notnull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

func recreateNotesTableWithUserID(db *sql.DB) error {
	stmts := []string{
		`ALTER TABLE notes RENAME TO notes_legacy`,
		`CREATE TABLE notes (
			user_id INTEGER NOT NULL DEFAULT 1,
			key TEXT NOT NULL,
			bookKey TEXT NOT NULL,
			chapter TEXT,
			chapterIndex INTEGER,
			text TEXT,
			cfi TEXT,
			range TEXT,
			notes TEXT,
			date TEXT,
			percentage TEXT,
			color TEXT,
			tag TEXT,
			PRIMARY KEY (user_id, key)
		)`,
		`INSERT INTO notes (user_id, key, bookKey, chapter, chapterIndex, text, cfi, range, notes, date, percentage, color, tag)
		 SELECT 1, key, bookKey, chapter, chapterIndex, text, cfi, range, notes, date, percentage, color, tag FROM notes_legacy`,
		`DROP TABLE notes_legacy`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func recreateBookmarksTableWithUserID(db *sql.DB) error {
	stmts := []string{
		`ALTER TABLE bookmarks RENAME TO bookmarks_legacy`,
		`CREATE TABLE bookmarks (
			user_id INTEGER NOT NULL DEFAULT 1,
			key TEXT NOT NULL,
			bookKey TEXT NOT NULL,
			cfi TEXT,
			label TEXT,
			percentage TEXT,
			chapter TEXT,
			PRIMARY KEY (user_id, key)
		)`,
		`INSERT INTO bookmarks (user_id, key, bookKey, cfi, label, percentage, chapter)
		 SELECT 1, key, bookKey, cfi, label, percentage, chapter FROM bookmarks_legacy`,
		`DROP TABLE bookmarks_legacy`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func recreateRecordLocationsTableWithUserID(db *sql.DB) error {
	stmts := []string{
		`ALTER TABLE record_locations RENAME TO record_locations_legacy`,
		`CREATE TABLE record_locations (
			user_id INTEGER NOT NULL DEFAULT 1,
			bookKey TEXT NOT NULL,
			payload TEXT NOT NULL,
			percentage TEXT,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, bookKey)
		)`,
		`INSERT INTO record_locations (user_id, bookKey, payload, percentage, updated_at)
		 SELECT 1, bookKey, payload, percentage, updated_at FROM record_locations_legacy`,
		`DROP TABLE record_locations_legacy`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func seedDefaultAdmin(db *sql.DB) error {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	_, err := db.Exec(
		`INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at)
		 VALUES (?, ?, 'admin', 1, ?, ?)`,
		credentials.username,
		hashPassword(credentials.password),
		now,
		now,
	)
	return err
}

func ensureExistingBooksOwnership(db *sql.DB) error {
	_, err := db.Exec(`UPDATE books SET owner_user_id = 1 WHERE owner_user_id IS NULL OR owner_user_id = 0`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE books SET visible_to_all = 1 WHERE visible_to_all IS NULL`)
	return err
}

func hashPassword(password string) string {
	sum := sha256.Sum256([]byte(password))
	return hex.EncodeToString(sum[:])
}

func generateSessionToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func isAdmin(user *authenticatedUser) bool {
	return user != nil && user.Role == "admin"
}

func currentRecordFilter(user *authenticatedUser) recordFilter {
	if user == nil {
		return recordFilter{}
	}
	return recordFilter{
		userID: user.ID,
		role:   user.Role,
	}
}

func getSessionFromRequest(r *http.Request) (*librarySession, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(cookie.Value)
	if token == "" {
		return nil, errors.New("missing session token")
	}
	return getSessionByToken(token)
}

func getSessionByToken(token string) (*librarySession, error) {
	db, err := openLibraryDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	row := db.QueryRow(`
		SELECT s.token, s.user_id, u.username, u.role, s.expires_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token = ? AND u.enabled = 1
	`, token)

	session := &librarySession{}
	if err := row.Scan(&session.Token, &session.UserID, &session.Username, &session.Role, &session.ExpiresAt); err != nil {
		return nil, err
	}
	if session.ExpiresAt < time.Now().Unix() {
		_ = deleteSession(token)
		return nil, errors.New("session expired")
	}
	return session, nil
}

func deleteSession(token string) error {
	db, err := openLibraryDB()
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	return err
}

func saveSession(user *libraryUser) (*librarySession, error) {
	token, err := generateSessionToken()
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(30 * 24 * time.Hour).Unix()
	now := time.Now().Unix()

	db, err := openLibraryDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	if _, err := db.Exec(
		`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		token,
		user.ID,
		expiresAt,
		now,
	); err != nil {
		return nil, err
	}

	return &librarySession{
		Token:     token,
		UserID:    user.ID,
		Username:  user.Username,
		Role:      user.Role,
		ExpiresAt: expiresAt,
	}, nil
}

func setSessionCookie(w http.ResponseWriter, session *librarySession) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    session.Token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(session.ExpiresAt, 0),
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func authenticateLibraryUser(username, password string) (*libraryUser, error) {
	db, err := openLibraryDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	row := db.QueryRow(`SELECT id, username, password_hash, role, enabled, created_at, updated_at FROM users WHERE username = ?`, username)

	var user libraryUser
	var passwordHash string
	var enabledInt int
	if err := row.Scan(&user.ID, &user.Username, &passwordHash, &user.Role, &enabledInt, &user.CreatedAt, &user.UpdatedAt); err != nil {
		return nil, err
	}
	user.Enabled = enabledInt == 1
	if !user.Enabled {
		return nil, errors.New("user disabled")
	}
	if passwordHash != hashPassword(password) {
		return nil, errors.New("invalid password")
	}
	return &user, nil
}

func currentAuthenticatedUser(r *http.Request) (*authenticatedUser, error) {
	session, err := getSessionFromRequest(r)
	if err == nil {
		return &authenticatedUser{
			ID:       session.UserID,
			Username: session.Username,
			Role:     session.Role,
			Enabled:  true,
		}, nil
	}

	if authenticate(r) {
		user, err := findUserByUsername(credentials.username)
		if err != nil {
			return nil, err
		}
		return &authenticatedUser{
			ID:       user.ID,
			Username: user.Username,
			Role:     user.Role,
			Enabled:  user.Enabled,
		}, nil
	}
	return nil, err
}

func findUserByUsername(username string) (*libraryUser, error) {
	db, err := openLibraryDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	row := db.QueryRow(`SELECT id, username, role, enabled, created_at, updated_at FROM users WHERE username = ?`, username)
	var user libraryUser
	var enabledInt int
	if err := row.Scan(&user.ID, &user.Username, &user.Role, &enabledInt, &user.CreatedAt, &user.UpdatedAt); err != nil {
		return nil, err
	}
	user.Enabled = enabledInt == 1
	return &user, nil
}

func parseBookSort(r *http.Request) string {
	switch r.URL.Query().Get("sort") {
	case "name", "author", "size", "page", "key":
		return r.URL.Query().Get("sort")
	default:
		return "name"
	}
}

func parseSortOrder(r *http.Request) string {
	if strings.EqualFold(r.URL.Query().Get("order"), "desc") {
		return "DESC"
	}
	return "ASC"
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func listAccessibleBookKeys(userID int64) ([]string, error) {
	db, err := openLibraryDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query(`SELECT book_key FROM book_access WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func queryLibraryBooks(search, sortField, orderField string, user *authenticatedUser) ([]libraryBook, error) {
	db, err := openBooksDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	base := `SELECT key, COALESCE(name,''), COALESCE(author,''), COALESCE(description,''),
	                COALESCE(md5,''), COALESCE(cover,''), COALESCE(format,''), COALESCE(publisher,''),
	                COALESCE(size,0), COALESCE(page,0), COALESCE(path,''), COALESCE(charset,''),
	                COALESCE(isbn,''), COALESCE(douban_id,''), COALESCE(tags,''), COALESCE(series,''),
	                COALESCE(published_at,''), COALESCE(source,''), COALESCE(source_url,''), COALESCE(rating,''),
	                COALESCE(visible_to_all,1), COALESCE(owner_user_id,1)
	         FROM books`

	conditions := []string{}
	args := []any{}

	if search != "" {
		like := "%" + search + "%"
		conditions = append(conditions, `(name LIKE ? OR author LIKE ? OR description LIKE ?)`)
		args = append(args, like, like, like)
	}

	if user != nil && user.Role != "admin" {
		accessibleKeys, err := listAccessibleBookKeys(user.ID)
		if err != nil {
			return nil, err
		}
		permissionClause := `(visible_to_all = 1 OR owner_user_id = ?`
		args = append(args, user.ID)
		if len(accessibleKeys) > 0 {
			placeholders := strings.TrimRight(strings.Repeat("?,", len(accessibleKeys)), ",")
			permissionClause += ` OR key IN (` + placeholders + `)`
			for _, key := range accessibleKeys {
				args = append(args, key)
			}
		}
		permissionClause += `)`
		conditions = append(conditions, permissionClause)
	}

	if len(conditions) > 0 {
		base += ` WHERE ` + strings.Join(conditions, ` AND `)
	}
	base += fmt.Sprintf(" ORDER BY %s %s", sortField, orderField)

	rows, err := db.Query(base, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	books := []libraryBook{}
	for rows.Next() {
		var book libraryBook
		var visibleToAllInt int
		var ownerUserID int64
		if err := rows.Scan(
			&book.Key,
			&book.Name,
			&book.Author,
			&book.Description,
			&book.MD5,
			&book.Cover,
			&book.Format,
			&book.Publisher,
			&book.Size,
			&book.Page,
			&book.Path,
			&book.Charset,
			&book.ISBN,
			&book.DoubanID,
			&book.Tags,
			&book.Series,
			&book.PublishedAt,
			&book.Source,
			&book.SourceURL,
			&book.Rating,
			&visibleToAllInt,
			&ownerUserID,
		); err != nil {
			return nil, err
		}
		book.VisibleToAll = visibleToAllInt == 1
		book.Owner = ""
		if ownerUserID > 0 {
			book.Owner = lookupUsernameByID(ownerUserID)
		}
		books = append(books, book)
	}
	return books, rows.Err()
}

func queryLibraryBooksPaged(search, sortField, orderField string, page, pageSize int, user *authenticatedUser) ([]libraryBook, int, error) {
	db, err := openBooksDB()
	if err != nil {
		return nil, 0, err
	}
	defer db.Close()

	baseFrom := ` FROM books`
	conditions := []string{}
	args := []any{}

	if search != "" {
		like := "%" + search + "%"
		conditions = append(conditions, `(name LIKE ? OR author LIKE ? OR description LIKE ?)`)
		args = append(args, like, like, like)
	}

	if user != nil && user.Role != "admin" {
		accessibleKeys, err := listAccessibleBookKeys(user.ID)
		if err != nil {
			return nil, 0, err
		}
		permissionClause := `(visible_to_all = 1 OR owner_user_id = ?`
		args = append(args, user.ID)
		if len(accessibleKeys) > 0 {
			placeholders := strings.TrimRight(strings.Repeat("?,", len(accessibleKeys)), ",")
			permissionClause += ` OR key IN (` + placeholders + `)`
			for _, key := range accessibleKeys {
				args = append(args, key)
			}
		}
		permissionClause += `)`
		conditions = append(conditions, permissionClause)
	}

	if len(conditions) > 0 {
		baseFrom += ` WHERE ` + strings.Join(conditions, ` AND `)
	}

	countQuery := `SELECT COUNT(*)` + baseFrom
	var total int
	if err := db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	selectQuery := `SELECT key, COALESCE(name,''), COALESCE(author,''), COALESCE(description,''),
	                COALESCE(md5,''), COALESCE(cover,''), COALESCE(format,''), COALESCE(publisher,''),
	                COALESCE(size,0), COALESCE(page,0), COALESCE(path,''), COALESCE(charset,''),
	                COALESCE(isbn,''), COALESCE(douban_id,''), COALESCE(tags,''), COALESCE(series,''),
	                COALESCE(published_at,''), COALESCE(source,''), COALESCE(source_url,''), COALESCE(rating,''),
	                COALESCE(visible_to_all,1), COALESCE(owner_user_id,1)` +
		baseFrom +
		fmt.Sprintf(" ORDER BY %s %s LIMIT ? OFFSET ?", sortField, orderField)
	queryArgs := append(append([]any{}, args...), pageSize, offset)

	rows, err := db.Query(selectQuery, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	books := []libraryBook{}
	for rows.Next() {
		var book libraryBook
		var visibleToAllInt int
		var ownerUserID int64
		if err := rows.Scan(
			&book.Key,
			&book.Name,
			&book.Author,
			&book.Description,
			&book.MD5,
			&book.Cover,
			&book.Format,
			&book.Publisher,
			&book.Size,
			&book.Page,
			&book.Path,
			&book.Charset,
			&book.ISBN,
			&book.DoubanID,
			&book.Tags,
			&book.Series,
			&book.PublishedAt,
			&book.Source,
			&book.SourceURL,
			&book.Rating,
			&visibleToAllInt,
			&ownerUserID,
		); err != nil {
			return nil, 0, err
		}
		book.VisibleToAll = visibleToAllInt == 1
		book.Owner = ""
		if ownerUserID > 0 {
			book.Owner = lookupUsernameByID(ownerUserID)
		}
		books = append(books, book)
	}

	return books, total, rows.Err()
}

func lookupUsernameByID(id int64) string {
	db, err := openLibraryDB()
	if err != nil {
		return ""
	}
	defer db.Close()
	var username string
	if err := db.QueryRow(`SELECT username FROM users WHERE id = ?`, id).Scan(&username); err != nil {
		return ""
	}
	return username
}

func queryLibraryBook(key string, user *authenticatedUser) (*libraryBook, error) {
	books, err := queryLibraryBooks("", "key", "ASC", user)
	if err != nil {
		return nil, err
	}
	for _, book := range books {
		if book.Key == key {
			return &book, nil
		}
	}
	return nil, sql.ErrNoRows
}

func upsertLibraryBook(book libraryBook, ownerUserID int64, visibleToAll bool) error {
	db, err := openBooksDB()
	if err != nil {
		return err
	}
	defer db.Close()

	if ownerUserID == 0 {
		ownerUserID = 1
	}

	visible := 0
	if visibleToAll {
		visible = 1
	}

	_, err = db.Exec(`INSERT OR REPLACE INTO books
		(key, name, author, description, md5, cover, format, publisher, size, page, path, charset,
		 isbn, douban_id, tags, series, published_at, source, source_url, rating, owner_user_id, visible_to_all)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		book.Key,
		book.Name,
		book.Author,
		book.Description,
		book.MD5,
		book.Cover,
		book.Format,
		book.Publisher,
		book.Size,
		book.Page,
		book.Path,
		book.Charset,
		book.ISBN,
		book.DoubanID,
		book.Tags,
		book.Series,
		book.PublishedAt,
		book.Source,
		book.SourceURL,
		book.Rating,
		ownerUserID,
		visible,
	)
	return err
}

func deleteLibraryBookData(key string) error {
	db, err := openBooksDB()
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err := db.Exec(`DELETE FROM books WHERE key = ?`, key); err != nil {
		return err
	}

	libraryDB, err := openLibraryDB()
	if err != nil {
		return err
	}
	defer libraryDB.Close()
	stmts := []struct {
		query string
		arg   any
	}{
		{query: `DELETE FROM notes WHERE bookKey = ?`, arg: key},
		{query: `DELETE FROM bookmarks WHERE bookKey = ?`, arg: key},
		{query: `DELETE FROM record_locations WHERE bookKey = ?`, arg: key},
		{query: `DELETE FROM book_access WHERE book_key = ?`, arg: key},
	}
	for _, stmt := range stmts {
		if _, err := libraryDB.Exec(stmt.query, stmt.arg); err != nil {
			return err
		}
	}
	return nil
}

func listLibraryRecords(recordType string, filter recordFilter) ([]map[string]any, error) {
	if !allowedRecordTypes[recordType] {
		return nil, errors.New("Unsupported record type")
	}
	db, err := openLibraryDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := ""
	args := []any{}
	switch recordType {
	case "notes":
		query = `SELECT key, bookKey, chapter, chapterIndex, text, cfi, range, notes, date, percentage, color, tag FROM notes`
	case "bookmarks":
		query = `SELECT key, bookKey, cfi, label, percentage, chapter FROM bookmarks`
	case "record_locations":
		query = `SELECT bookKey, payload, percentage, updated_at FROM record_locations`
	}
	if filter.role != "admin" {
		query += ` WHERE user_id = ?`
		args = append(args, filter.userID)
	}
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func listLibraryRecordsByBookKey(recordType, bookKey string, filter recordFilter) ([]map[string]any, error) {
	if !allowedRecordTypes[recordType] {
		return nil, errors.New("Unsupported record type")
	}
	db, err := openLibraryDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := ""
	args := []any{}
	switch recordType {
	case "notes":
		query = `SELECT key, bookKey, chapter, chapterIndex, text, cfi, range, notes, date, percentage, color, tag FROM notes WHERE bookKey = ?`
		args = append(args, bookKey)
	case "bookmarks":
		query = `SELECT key, bookKey, cfi, label, percentage, chapter FROM bookmarks WHERE bookKey = ?`
		args = append(args, bookKey)
	case "record_locations":
		query = `SELECT bookKey, payload, percentage, updated_at FROM record_locations WHERE bookKey = ?`
		args = append(args, bookKey)
	}
	if filter.role != "admin" {
		query += ` AND user_id = ?`
		args = append(args, filter.userID)
	}
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func rowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	results := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		valuePtrs := make([]any, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
		}
		rowMap := map[string]any{}
		for i, col := range columns {
			raw := values[i]
			switch v := raw.(type) {
			case []byte:
				rowMap[col] = string(v)
			default:
				rowMap[col] = v
			}
		}
		results = append(results, rowMap)
	}
	return results, rows.Err()
}

func saveLibraryRecord(recordType string, raw map[string]any, userID int64) error {
	if !allowedRecordTypes[recordType] {
		return errors.New("Unsupported record type")
	}
	db, err := openLibraryDB()
	if err != nil {
		return err
	}
	defer db.Close()

	switch recordType {
	case "notes":
		tag := marshalJSONValue(raw["tag"])
		date := marshalJSONValue(raw["date"])
		_, err = db.Exec(`INSERT OR REPLACE INTO notes
			(user_id, key, bookKey, chapter, chapterIndex, text, cfi, range, notes, date, percentage, color, tag)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID,
			stringValue(raw["key"]),
			stringValue(raw["bookKey"]),
			stringValue(raw["chapter"]),
			intValue(raw["chapterIndex"]),
			stringValue(raw["text"]),
			stringValue(raw["cfi"]),
			stringValue(raw["range"]),
			stringValue(raw["notes"]),
			date,
			stringValue(raw["percentage"]),
			stringValue(raw["color"]),
			tag,
		)
	case "bookmarks":
		_, err = db.Exec(`INSERT OR REPLACE INTO bookmarks
			(user_id, key, bookKey, cfi, label, percentage, chapter)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			userID,
			stringValue(raw["key"]),
			stringValue(raw["bookKey"]),
			stringValue(raw["cfi"]),
			stringValue(raw["label"]),
			stringValue(raw["percentage"]),
			stringValue(raw["chapter"]),
		)
	case "record_locations":
		now := time.Now().UnixMilli()
		bookKey := stringValue(raw["bookKey"])
		if bookKey == "" {
			bookKey = stringValue(raw["key"])
		}
		_, err = db.Exec(`INSERT OR REPLACE INTO record_locations
			(user_id, bookKey, payload, percentage, updated_at)
			VALUES (?, ?, ?, ?, ?)`,
			userID,
			bookKey,
			marshalJSONValue(raw["payload"]),
			stringValue(raw["percentage"]),
			now,
		)
	}
	return err
}

func deleteLibraryRecord(recordType, key string, userID int64, isAdmin bool) error {
	if !allowedRecordTypes[recordType] {
		return errors.New("Unsupported record type")
	}
	db, err := openLibraryDB()
	if err != nil {
		return err
	}
	defer db.Close()

	query := ""
	args := []any{}
	switch recordType {
	case "notes", "bookmarks":
		query = fmt.Sprintf(`DELETE FROM %s WHERE key = ?`, recordType)
		args = append(args, key)
		if !isAdmin {
			query += ` AND user_id = ?`
			args = append(args, userID)
		}
	case "record_locations":
		query = `DELETE FROM record_locations WHERE bookKey = ?`
		args = append(args, key)
		if !isAdmin {
			query += ` AND user_id = ?`
			args = append(args, userID)
		}
	}
	_, err = db.Exec(query, args...)
	return err
}

func marshalJSONValue(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		buf, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(buf)
	}
}

func stringValue(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case bool:
		if v {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", v)
	}
}

func intValue(value any) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case string:
		num, _ := strconv.Atoi(v)
		return num
	default:
		return 0
	}
}

func boolValue(value any, fallback bool) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		if v == "" {
			return fallback
		}
		return strings.EqualFold(v, "true") || v == "1" || strings.EqualFold(v, "yes")
	case float64:
		return v != 0
	case int:
		return v != 0
	default:
		return fallback
	}
}

func parseMultipartBook(r *http.Request) (libraryBook, []byte, error) {
	book := libraryBook{}
	if err := r.ParseMultipartForm(512 << 20); err != nil {
		return book, nil, err
	}
	metadata := r.FormValue("metadata")
	if metadata == "" {
		return book, nil, errors.New("Missing metadata field")
	}
	if err := json.Unmarshal([]byte(metadata), &book); err != nil {
		return book, nil, err
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return book, nil, err
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	if err != nil {
		return book, nil, err
	}
	if book.Format == "" {
		book.Format = strings.TrimPrefix(strings.ToLower(filepath.Ext(header.Filename)), ".")
	}
	if book.Size == 0 {
		book.Size = int64(len(content))
	}
	_ = header
	return book, content, nil
}

func parseOptionalCover(r *http.Request) (string, []byte, error) {
	file, header, err := r.FormFile("cover")
	if errors.Is(err, http.ErrMissingFile) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	if err != nil {
		return "", nil, err
	}
	return header.Filename, content, nil
}

func writeBookFile(book libraryBook, content []byte) error {
	fileName := book.Key + "." + strings.ToLower(book.Format)
	target, err := resolveSafePath("book", fileName)
	if err != nil {
		return err
	}
	return os.WriteFile(target, content, 0o644)
}

func writeCoverFile(bookKey string, fileName string, content []byte) (string, error) {
	if fileName == "" || len(content) == 0 {
		return "", nil
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if ext == "" {
		ext = ".jpg"
	}
	coverName := bookKey + ext
	target, err := resolveSafePath("cover", coverName)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(target, content, 0o644); err != nil {
		return "", err
	}
	return coverName, nil
}

func serveLibraryCover(w http.ResponseWriter, r *http.Request, book *libraryBook) {
	if book == nil || strings.TrimSpace(book.Cover) == "" {
		writePlain(w, http.StatusNotFound, "Cover not found")
		return
	}

	cover := strings.TrimSpace(book.Cover)
	if strings.HasPrefix(cover, "data:") {
		parts := strings.SplitN(cover, ",", 2)
		if len(parts) != 2 {
			writePlain(w, http.StatusBadRequest, "Invalid cover data")
			return
		}
		meta := parts[0]
		contentType := "image/jpeg"
		if typePart := strings.TrimPrefix(strings.SplitN(meta, ";", 2)[0], "data:"); typePart != "" {
			contentType = typePart
		}
		payload, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			writePlain(w, http.StatusBadRequest, "Invalid cover data")
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_, _ = w.Write(payload)
		return
	}

	if strings.HasPrefix(cover, "http://") || strings.HasPrefix(cover, "https://") {
		client := &http.Client{Timeout: 20 * time.Second}
		req, err := http.NewRequest(http.MethodGet, cover, nil)
		if err != nil {
			writePlain(w, http.StatusBadRequest, "Invalid cover url")
			return
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
		req.Header.Set("Referer", "https://book.douban.com/")
		req.Header.Set("Origin", "https://book.douban.com")
		resp, err := client.Do(req)
		if err != nil {
			writePlain(w, http.StatusBadGateway, "Failed to fetch remote cover")
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			writePlain(w, http.StatusBadGateway, fmt.Sprintf("Remote cover request failed: %s", resp.Status))
			return
		}
		contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
		if contentType == "" {
			contentType = mime.TypeByExtension(filepath.Ext(cover))
		}
		if contentType == "" {
			contentType = "image/jpeg"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "public, max-age=3600")
		if contentLength := resp.Header.Get("Content-Length"); contentLength != "" {
			w.Header().Set("Content-Length", contentLength)
		}
		_, _ = io.Copy(w, resp.Body)
		return
	}

	target, err := resolveSafePath("cover", cover)
	if err != nil {
		writePlain(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := os.Stat(target); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writePlain(w, http.StatusNotFound, "Cover not found")
			return
		}
		writePlain(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.ServeFile(w, r, target)
}

func listBookAccess(bookKey string) ([]string, error) {
	db, err := openLibraryDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT u.username
		FROM book_access ba
		JOIN users u ON u.id = ba.user_id
		WHERE ba.book_key = ?
		ORDER BY u.username ASC
	`, bookKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []string{}
	for rows.Next() {
		var username string
		if err := rows.Scan(&username); err != nil {
			return nil, err
		}
		result = append(result, username)
	}
	return result, rows.Err()
}

func updateBookAccess(bookKey string, usernames []string) error {
	db, err := openLibraryDB()
	if err != nil {
		return err
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM book_access WHERE book_key = ?`, bookKey); err != nil {
		return err
	}

	for _, username := range usernames {
		user := strings.TrimSpace(username)
		if user == "" {
			continue
		}
		var userID int64
		if err := tx.QueryRow(`SELECT id FROM users WHERE username = ?`, user).Scan(&userID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return err
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO book_access (book_key, user_id) VALUES (?, ?)`, bookKey, userID); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	booksDB, err := openBooksDB()
	if err != nil {
		return err
	}
	defer booksDB.Close()

	visible := 1
	if len(usernames) > 0 {
		visible = 0
	}
	_, err = booksDB.Exec(`UPDATE books SET visible_to_all = ? WHERE key = ?`, visible, bookKey)
	return err
}

func parseStringList(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		result := make([]string, 0, len(v))
		for _, item := range v {
			if s := strings.TrimSpace(stringValue(item)); s != "" {
				result = append(result, s)
			}
		}
		return result
	case string:
		if v == "" {
			return nil
		}
		if strings.Contains(v, ",") {
			parts := strings.Split(v, ",")
			result := make([]string, 0, len(parts))
			for _, item := range parts {
				item = strings.TrimSpace(item)
				if item != "" {
					result = append(result, item)
				}
			}
			return result
		}
		return []string{v}
	default:
		return nil
	}
}

func handleLibrarySession(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		user, err := currentAuthenticatedUser(r)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"authenticated": false,
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"authenticated": true,
			"user": map[string]any{
				"id":       user.ID,
				"username": user.Username,
				"role":     user.Role,
			},
		})
	case http.MethodPost:
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := decodeJSON(r, &payload); err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		user, err := authenticateLibraryUser(strings.TrimSpace(payload.Username), payload.Password)
		if err != nil {
			writePlain(w, http.StatusUnauthorized, "Invalid username or password")
			return
		}
		session, err := saveSession(user)
		if err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		setSessionCookie(w, session)
		writeJSON(w, http.StatusOK, map[string]any{
			"authenticated": true,
			"user":          user,
		})
	case http.MethodDelete:
		if session, err := getSessionFromRequest(r); err == nil {
			_ = deleteSession(session.Token)
		}
		clearSessionCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func handleLibraryUsers(w http.ResponseWriter, r *http.Request, currentUser *authenticatedUser) {
	if !isAdmin(currentUser) {
		writePlain(w, http.StatusForbidden, "Admin only")
		return
	}
	db, err := openLibraryDB()
	if err != nil {
		writePlain(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer db.Close()

	switch r.Method {
	case http.MethodGet:
		rows, err := db.Query(`SELECT id, username, role, enabled, created_at, updated_at FROM users ORDER BY username ASC`)
		if err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer rows.Close()

		users := []libraryUser{}
		for rows.Next() {
			var user libraryUser
			var enabledInt int
			if err := rows.Scan(&user.ID, &user.Username, &user.Role, &enabledInt, &user.CreatedAt, &user.UpdatedAt); err != nil {
				writePlain(w, http.StatusInternalServerError, err.Error())
				return
			}
			user.Enabled = enabledInt == 1
			users = append(users, user)
		}
		writeJSON(w, http.StatusOK, users)
	case http.MethodPost:
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
			Role     string `json:"role"`
			Enabled  *bool  `json:"enabled"`
		}
		if err := decodeJSON(r, &payload); err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		username := strings.TrimSpace(payload.Username)
		if username == "" || payload.Password == "" {
			writePlain(w, http.StatusBadRequest, "username and password are required")
			return
		}
		role := payload.Role
		if role != "admin" {
			role = "user"
		}
		enabled := true
		if payload.Enabled != nil {
			enabled = *payload.Enabled
		}
		enabledInt := 0
		if enabled {
			enabledInt = 1
		}
		now := time.Now().UnixMilli()
		_, err := db.Exec(
			`INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			username,
			hashPassword(payload.Password),
			role,
			enabledInt,
			now,
			now,
		)
		if err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		user, _ := findUserByUsername(username)
		writeJSON(w, http.StatusOK, user)
	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func handleLibraryUser(w http.ResponseWriter, r *http.Request, username string, currentUser *authenticatedUser) {
	if !isAdmin(currentUser) {
		writePlain(w, http.StatusForbidden, "Admin only")
		return
	}
	db, err := openLibraryDB()
	if err != nil {
		writePlain(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer db.Close()

	switch r.Method {
	case http.MethodPut:
		payload, err := parseRecordPayload(r)
		if err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		role := stringValue(payload["role"])
		if role != "admin" {
			role = "user"
		}
		enabledInt := 1
		if !boolValue(payload["enabled"], true) {
			enabledInt = 0
		}
		parts := []string{`role = ?`, `enabled = ?`, `updated_at = ?`}
		args := []any{role, enabledInt, time.Now().UnixMilli()}
		if password := stringValue(payload["password"]); password != "" {
			parts = append(parts, `password_hash = ?`)
			args = append(args, hashPassword(password))
		}
		args = append(args, username)
		query := `UPDATE users SET ` + strings.Join(parts, `, `) + ` WHERE username = ?`
		if _, err := db.Exec(query, args...); err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		user, err := findUserByUsername(username)
		if err != nil {
			writePlain(w, http.StatusNotFound, "User not found")
			return
		}
		writeJSON(w, http.StatusOK, user)
	case http.MethodDelete:
		if username == currentUser.Username {
			writePlain(w, http.StatusBadRequest, "Cannot delete current admin user")
			return
		}
		var userID int64
		if err := db.QueryRow(`SELECT id FROM users WHERE username = ?`, username).Scan(&userID); err != nil {
			writePlain(w, http.StatusNotFound, "User not found")
			return
		}
		if _, err := db.Exec(`DELETE FROM sessions WHERE user_id = ?`, userID); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		if _, err := db.Exec(`DELETE FROM book_access WHERE user_id = ?`, userID); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		if _, err := db.Exec(`DELETE FROM users WHERE id = ?`, userID); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func handleLibrarySettings(w http.ResponseWriter, r *http.Request, currentUser *authenticatedUser) {
	if !isAdmin(currentUser) {
		writePlain(w, http.StatusForbidden, "Admin only")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"adminUsername": currentUser.Username,
		})
	case http.MethodPut:
		var payload struct {
			AdminUsername string `json:"adminUsername"`
			AdminPassword string `json:"adminPassword"`
		}
		if err := decodeJSON(r, &payload); err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		adminUsername := strings.TrimSpace(payload.AdminUsername)
		if adminUsername == "" {
			adminUsername = currentUser.Username
		}

		db, err := openLibraryDB()
		if err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer db.Close()

		tx, err := db.Begin()
		if err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer tx.Rollback()

		parts := []string{`username = ?`, `updated_at = ?`}
		args := []any{adminUsername, time.Now().UnixMilli()}
		if strings.TrimSpace(payload.AdminPassword) != "" {
			parts = append(parts, `password_hash = ?`)
			args = append(args, hashPassword(payload.AdminPassword))
		}
		args = append(args, currentUser.ID)
		if _, err := tx.Exec(`UPDATE users SET `+strings.Join(parts, `, `)+` WHERE id = ?`, args...); err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := tx.Exec(`DELETE FROM sessions WHERE user_id = ?`, currentUser.ID); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := tx.Commit(); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}

		clearSessionCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func handleLibraryMetadata(w http.ResponseWriter, r *http.Request, currentUser *authenticatedUser) {
	_ = currentUser
	switch r.Method {
	case http.MethodGet:
		source := strings.TrimSpace(r.URL.Query().Get("source"))
		key := strings.TrimSpace(r.URL.Query().Get("key"))
		isbn := strings.TrimSpace(r.URL.Query().Get("isbn"))
		switch {
		case source != "" && key != "":
			result, err := fetchMetadataBySource(source, key)
			if err != nil {
				writePlain(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, metadataDetailResponse{
				Code: 200,
				Data: result,
			})
		case isbn != "":
			result, err := getDoubanBookByISBN(isbn)
			if err != nil {
				writePlain(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, metadataDetailResponse{
				Code: 200,
				Data: result,
			})
		default:
			name := strings.TrimSpace(r.URL.Query().Get("name"))
			author := strings.TrimSpace(r.URL.Query().Get("author"))
			results, err := fetchMetadataCandidates(name, author)
			if err != nil {
				writePlain(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"code": 200,
				"data": results,
			})
		}
	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func urlQueryEscape(value string) string {
	replacer := strings.NewReplacer(" ", "%20", "#", "%23", "&", "%26", "+", "%2B", "?", "%3F")
	return replacer.Replace(value)
}

func handleLibraryBooks(w http.ResponseWriter, r *http.Request, currentUser *authenticatedUser) {
	switch r.Method {
	case http.MethodGet:
		page := parsePositiveInt(r.URL.Query().Get("page"), 1)
		pageSize := parsePositiveInt(r.URL.Query().Get("pageSize"), 24)
		if pageSize > 200 {
			pageSize = 200
		}
		books, total, err := queryLibraryBooksPaged(
			r.URL.Query().Get("q"),
			parseBookSort(r),
			parseSortOrder(r),
			page,
			pageSize,
			currentUser,
		)
		if err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, pagedBooksResponse{
			Items:    books,
			Total:    total,
			Page:     page,
			PageSize: pageSize,
		})
	case http.MethodPost:
		if currentUser == nil {
			writePlain(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if currentUser.Role != "admin" {
			writePlain(w, http.StatusForbidden, "Only admin can upload books")
			return
		}
		book, content, err := parseMultipartBook(r)
		if err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		coverFileName, coverContent, err := parseOptionalCover(r)
		if err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := writeBookFile(book, content); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		if coverName, err := writeCoverFile(book.Key, coverFileName, coverContent); err == nil && coverName != "" {
			book.Cover = coverName
		} else if err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := upsertLibraryBook(book, currentUser.ID, true); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, book)
	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func parseRecordPayload(r *http.Request) (map[string]any, error) {
	payload := map[string]any{}
	if err := decodeJSON(r, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func handleLibraryBookPermissions(w http.ResponseWriter, r *http.Request, key string, currentUser *authenticatedUser) {
	if !isAdmin(currentUser) {
		writePlain(w, http.StatusForbidden, "Admin only")
		return
	}
	switch r.Method {
	case http.MethodGet:
		users, err := listBookAccess(key)
		if err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"users": users,
		})
	case http.MethodPut:
		payload, err := parseRecordPayload(r)
		if err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		users := parseStringList(payload["users"])
		if err := updateBookAccess(key, users); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "users": users})
	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func handleLibraryBook(w http.ResponseWriter, r *http.Request, key string, action string, currentUser *authenticatedUser) {
	switch action {
	case "":
		switch r.Method {
		case http.MethodGet:
			book, err := queryLibraryBook(key, currentUser)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					writePlain(w, http.StatusNotFound, "Book not found")
					return
				}
				writePlain(w, http.StatusInternalServerError, err.Error())
				return
			}
			permissions, _ := listBookAccess(key)
			writeJSON(w, http.StatusOK, map[string]any{
				"book":        book,
				"permissions": permissions,
			})
		case http.MethodPut:
			if !isAdmin(currentUser) {
				writePlain(w, http.StatusForbidden, "Admin only")
				return
			}
			payload, err := parseRecordPayload(r)
			if err != nil {
				writePlain(w, http.StatusBadRequest, err.Error())
				return
			}
			book := libraryBook{
				Key:         key,
				Name:        stringValue(payload["name"]),
				Author:      stringValue(payload["author"]),
				Description: stringValue(payload["description"]),
				MD5:         stringValue(payload["md5"]),
				Cover:       stringValue(payload["cover"]),
				Format:      stringValue(payload["format"]),
				Publisher:   stringValue(payload["publisher"]),
				Size:        int64(intValue(payload["size"])),
				Page:        intValue(payload["page"]),
				Path:        stringValue(payload["path"]),
				Charset:     stringValue(payload["charset"]),
				ISBN:        stringValue(payload["isbn"]),
				DoubanID:    stringValue(payload["doubanId"]),
				Tags:        stringValue(payload["tags"]),
				Series:      stringValue(payload["series"]),
				PublishedAt: stringValue(payload["publishedAt"]),
				Source:      stringValue(payload["source"]),
				SourceURL:   stringValue(payload["sourceUrl"]),
				Rating:      stringValue(payload["rating"]),
			}
			ownerUserID := currentUser.ID
			visibleToAll := boolValue(payload["visibleToAll"], true)
			if owner := stringValue(payload["owner"]); owner != "" {
				if user, err := findUserByUsername(owner); err == nil {
					ownerUserID = user.ID
				}
			}
			if existing, err := queryLibraryBook(key, currentUser); err == nil {
				if book.Format == "" {
					book.Format = existing.Format
				}
				if book.Cover == "" {
					book.Cover = existing.Cover
				}
			}
			if err := upsertLibraryBook(book, ownerUserID, visibleToAll); err != nil {
				writePlain(w, http.StatusInternalServerError, err.Error())
				return
			}
			if users := parseStringList(payload["permissions"]); users != nil {
				if err := updateBookAccess(key, users); err != nil {
					writePlain(w, http.StatusInternalServerError, err.Error())
					return
				}
			}
			writeJSON(w, http.StatusOK, book)
		case http.MethodDelete:
			if !isAdmin(currentUser) {
				writePlain(w, http.StatusForbidden, "Admin only")
				return
			}
			book, err := queryLibraryBook(key, currentUser)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				writePlain(w, http.StatusInternalServerError, err.Error())
				return
			}
			if book != nil {
				_ = os.Remove(filepath.Join(uploadDir, "book", key+"."+strings.ToLower(book.Format)))
				if book.Cover != "" {
					_ = os.Remove(filepath.Join(uploadDir, "cover", book.Cover))
				}
			}
			if err := deleteLibraryBookData(key); err != nil {
				writePlain(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"success": true})
		default:
			writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		}
	case "file":
		book, err := queryLibraryBook(key, currentUser)
		if err != nil {
			writePlain(w, http.StatusNotFound, "Book not found")
			return
		}
		target, err := resolveSafePath("book", key+"."+strings.ToLower(book.Format))
		if err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		http.ServeFile(w, r, target)
	case "cover":
		book, err := queryLibraryBook(key, currentUser)
		if err != nil {
			writePlain(w, http.StatusNotFound, "Cover not found")
			return
		}
		serveLibraryCover(w, r, book)
	case "permissions":
		handleLibraryBookPermissions(w, r, key, currentUser)
	default:
		writePlain(w, http.StatusNotFound, "Not Found")
	}
}

func handleLibraryRecords(w http.ResponseWriter, r *http.Request, path string, currentUser *authenticatedUser) {
	trimmed := strings.TrimPrefix(path, "/api/library/records/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writePlain(w, http.StatusNotFound, "Not Found")
		return
	}
	recordType := parts[0]
	if !allowedRecordTypes[recordType] {
		writePlain(w, http.StatusBadRequest, "Unsupported record type")
		return
	}
	filter := currentRecordFilter(currentUser)

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			records, err := listLibraryRecords(recordType, filter)
			if err != nil {
				writePlain(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, records)
		case http.MethodPost:
			payload, err := parseRecordPayload(r)
			if err != nil {
				writePlain(w, http.StatusBadRequest, err.Error())
				return
			}
			if err := saveLibraryRecord(recordType, payload, currentUser.ID); err != nil {
				writePlain(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, payload)
		default:
			writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
		}
		return
	}

	if len(parts) >= 3 && parts[1] == "by-book" {
		records, err := listLibraryRecordsByBookKey(recordType, parts[2], filter)
		if err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, records)
		return
	}

	key := parts[1]
	switch r.Method {
	case http.MethodPut:
		payload, err := parseRecordPayload(r)
		if err != nil {
			writePlain(w, http.StatusBadRequest, err.Error())
			return
		}
		if recordType == "record_locations" {
			payload["bookKey"] = key
		} else {
			payload["key"] = key
		}
		if err := saveLibraryRecord(recordType, payload, currentUser.ID); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, payload)
	case http.MethodDelete:
		if err := deleteLibraryRecord(recordType, key, currentUser.ID, isAdmin(currentUser)); err != nil {
			writePlain(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
	default:
		writePlain(w, http.StatusMethodNotAllowed, "Method Not Allowed")
	}
}

func libraryRequiresSession(path string) bool {
	publicPaths := map[string]bool{
		"/api/library/session": true,
	}
	if publicPaths[path] {
		return false
	}
	return true
}

func libraryHandler(w http.ResponseWriter, r *http.Request) {
	if !libraryEnabled {
		writePlain(w, http.StatusNotFound, "Not Found")
		return
	}
	path := strings.TrimSuffix(r.URL.Path, "/")
	if path == "" {
		path = r.URL.Path
	}

	var currentUser *authenticatedUser
	var err error
	if libraryRequiresSession(path) {
		currentUser, err = currentAuthenticatedUser(r)
		if err != nil || currentUser == nil {
			writePlain(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
	}

	switch {
	case path == "/api/library/session":
		handleLibrarySession(w, r)
	case path == "/api/library/users":
		handleLibraryUsers(w, r, currentUser)
	case strings.HasPrefix(path, "/api/library/users/"):
		username := strings.TrimPrefix(path, "/api/library/users/")
		handleLibraryUser(w, r, username, currentUser)
	case path == "/api/library/settings":
		handleLibrarySettings(w, r, currentUser)
	case path == "/api/library/metadata":
		handleLibraryMetadata(w, r, currentUser)
	case path == "/api/library/books":
		handleLibraryBooks(w, r, currentUser)
	case strings.HasPrefix(path, "/api/library/books/"):
		trimmed := strings.TrimPrefix(path, "/api/library/books/")
		parts := strings.Split(trimmed, "/")
		key := parts[0]
		action := ""
		if len(parts) > 1 {
			action = parts[1]
		}
		handleLibraryBook(w, r, key, action, currentUser)
	case strings.HasPrefix(path, "/api/library/records/"):
		handleLibraryRecords(w, r, path, currentUser)
	default:
		writePlain(w, http.StatusNotFound, "Not Found")
	}
}
