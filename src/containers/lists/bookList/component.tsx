import React from "react";
import "./booklist.css";
import BookCardItem from "../../../components/bookCardItem";
import BookListItem from "../../../components/bookListItem";
import BookCoverItem from "../../../components/bookCoverItem";
import BookModel from "../../../models/Book";
import { BookListProps, BookListState } from "./interface";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { Redirect, withRouter } from "react-router-dom";
import ViewMode from "../../../components/viewMode";
import SelectBook from "../../../components/selectBook";
import Book from "../../../models/Book";
import { isElectron } from "react-device-detect";
import DatabaseService from "../../../utils/storage/databaseService";
import { throttle } from "../../../utils/common";
import ServerLibrary from "../../../utils/storage/serverLibrary";
declare var window: any;
let currentBookMode = "home";

type TagStat = {
  name: string;
  count: number;
};

function getBookCountPerPage() {
  const container = document.querySelector(
    ".book-list-container"
  ) as HTMLElement;
  const viewMode = ConfigService.getReaderConfig("viewMode") || "card";
  if (viewMode === "list") {
    return 10;
  }
  if (!container) {
    return viewMode === "cover" ? 12 : 27;
  }
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const metrics =
    viewMode === "cover"
      ? { bookWidth: 320, bookHeight: 240, minRows: 3 }
      : { bookWidth: 148, bookHeight: 220, minRows: 3 };
  const columns = Math.max(1, Math.floor(containerWidth / metrics.bookWidth));
  const rows = Math.max(
    metrics.minRows,
    Math.floor(containerHeight / metrics.bookHeight)
  );
  return columns * rows;
}

class BookList extends React.Component<BookListProps, BookListState> {
  private scrollContainer: React.RefObject<HTMLUListElement>;
  private visibilityChangeHandler: ((event: Event) => void) | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor(props: BookListProps) {
    super(props);
    this.scrollContainer = React.createRef();
    this.state = {
      favoriteBooks: Object.keys(
        ConfigService.getAllListConfig("favoriteBooks")
      ).length,
      isHideShelfBook:
        ConfigService.getReaderConfig("isHideShelfBook") === "yes",
      displayedBooksCount: 24,
      isLoadingMore: false,
      fullBooksData: [], // 存储从数据库加载的完整书籍数据
      cardScale: parseFloat(ConfigService.getReaderConfig("cardScale") || "1"),
      readingStatusFilter: "",
      tagFilter: "",
      serverPage: 1,
      tagStats: [],
      taggedBooksCount: 0,
      totalTagBooks: 0,
    };
  }
  UNSAFE_componentWillMount() {
    this.props.handleFetchBooks();
  }

  async componentDidMount() {
    // The library request is asynchronous. Do not treat the initial null
    // value as an empty library before the first response arrives.
    if (!this.props.books) {
      return;
    }
    if (DatabaseService.isServerMode()) {
      await this.loadServerTagStats();
      return;
    }
    this.setState({
      displayedBooksCount: getBookCountPerPage(),
    });

    // 保存 resize 监听器引用（节流，避免拖拽窗口时频繁触发）
    this.resizeHandler = throttle(() => {
      //recount the book count per page when the window is resized
      this.props.handleFetchBooks();
    });
    window.addEventListener("resize", this.resizeHandler);

    // 设置滚动监听器
    this.setupScrollListener();

    // 保存 visibilitychange 监听器引用
    this.visibilityChangeHandler = async (event) => {
      if (document.visibilityState === "visible" && !isElectron) {
        await this.handleFinishReading();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityChangeHandler);

    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      ipcRenderer.on("reading-finished", async (event: any, config: any) => {
        this.handleFinishReading();
      });
    }

    // 初始加载完整的书籍数据
    await this.loadFullBooksData();
  }

  componentWillUnmount() {
    // 清理滚动监听器
    this.cleanupScrollListener();

    // 清理 resize 监听器
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // 清理 visibilitychange 监听器
    if (this.visibilityChangeHandler) {
      document.removeEventListener(
        "visibilitychange",
        this.visibilityChangeHandler
      );
      this.visibilityChangeHandler = null;
    }

    // 清理 IPC 监听器
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      ipcRenderer.removeAllListeners("reading-finished");
    }
  }

  componentDidUpdate(prevProps: BookListProps, prevState: BookListState) {
    // 当书籍列表更新时，重置显示数量
    if (
      prevProps.books !== this.props.books ||
      prevProps.searchResults !== this.props.searchResults ||
      prevProps.isSearch !== this.props.isSearch ||
      prevProps.mode !== this.props.mode ||
      prevProps.shelfTitle !== this.props.shelfTitle
    ) {
      this.setState({
        displayedBooksCount: getBookCountPerPage(),
        isLoadingMore: false,
        serverPage: 1,
      });
      this.props.handleLoadMore(false);
      // 滚动到顶部
      if (this.scrollContainer.current) {
        this.scrollContainer.current.scrollTop = 0;
      }
      // 重新加载完整的书籍数据
      this.loadFullBooksData();
      if (DatabaseService.isServerMode()) {
        this.loadServerTagStats();
      }
    }
    // 阅读状态筛选变化时，重新加载完整书籍数据
    if (prevState.readingStatusFilter !== this.state.readingStatusFilter) {
      this.loadFullBooksData();
      if (DatabaseService.isServerMode()) {
        this.props.handleFetchBooks(1, this.props.booksPageSize, this.state.tagFilter);
      }
    }
    if (prevState.tagFilter !== this.state.tagFilter) {
      this.props.handleFetchBooks(1, this.props.booksPageSize, this.state.tagFilter);
    }
  }

  loadServerTagStats = async () => {
    if (!DatabaseService.isServerMode()) {
      return;
    }
    try {
      const response = await ServerLibrary.getTags();
      this.setState({
        tagStats: response.items || [],
        taggedBooksCount: response.taggedBooksCount || 0,
        totalTagBooks: response.totalBooks || 0,
      });
    } catch (error) {
      console.error("Failed to load server tag stats:", error);
    }
  };

  // 从数据库加载完整的书籍数据
  loadFullBooksData = async () => {
    if (DatabaseService.isServerMode()) {
      this.setState({ fullBooksData: this.props.books || [] });
      return;
    }
    const { books } = this.handleBooks();
    const displayedBooks = books.slice(0, this.state.displayedBooksCount);

    const fullBooksData: Book[] = [];
    for (let i = 0; i < displayedBooks.length; i++) {
      const book = await DatabaseService.getRecord(
        displayedBooks[i].key,
        "books"
      );
      if (book) {
        fullBooksData.push(book);
      }
    }

    this.setState({ fullBooksData });
  };
  handleFinishReading = async () => {
    if (!this.scrollContainer.current) return;
    if (
      this.scrollContainer.current &&
      this.scrollContainer.current.scrollTop > 100
    ) {
      //ignore if the scroll is not at top
    } else {
      this.props.handleFetchBooks();
    }
  };

  setupScrollListener = () => {
    if (DatabaseService.isServerMode()) {
      return;
    }
    const scrollContainer = this.scrollContainer.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", this.handleScroll);
    }
  };

  cleanupScrollListener = () => {
    const scrollContainer = this.scrollContainer.current;
    if (scrollContainer) {
      scrollContainer.removeEventListener("scroll", this.handleScroll);
    }
  };

  handleScroll = () => {
    const scrollContainer = this.scrollContainer.current;
    if (!scrollContainer || this.state.isLoadingMore) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    // 当滚动到底部附近时触发加载更多
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      this.loadMoreBooks();
    }
  };

  loadMoreBooks = () => {
    if (DatabaseService.isServerMode()) {
      return;
    }
    const { books } = this.handleBooks();
    const { displayedBooksCount } = this.state;

    if (displayedBooksCount >= books.length) {
      return; // 已经显示所有图书
    }

    this.setState({ isLoadingMore: true });
    this.props.handleLoadMore(true);
    // 异步加载更多书籍数据
    setTimeout(async () => {
      const newDisplayedBooksCount = Math.min(
        displayedBooksCount + getBookCountPerPage(),
        books.length
      );

      // 加载新增的书籍数据
      const newBooks = books.slice(displayedBooksCount, newDisplayedBooksCount);
      const newFullBooksData: Book[] = [];
      for (let i = 0; i < newBooks.length; i++) {
        const book = await DatabaseService.getRecord(newBooks[i].key, "books");
        if (book) {
          newFullBooksData.push(book);
        }
      }

      this.setState({
        displayedBooksCount: newDisplayedBooksCount,
        isLoadingMore: false,
        fullBooksData: [...this.state.fullBooksData, ...newFullBooksData],
      });
    }, 100);
  };

  handleKeyFilter = (items: any[], arr: string[]) => {
    let itemArr: any[] = [];
    arr.forEach((item) => {
      items.forEach((subItem: any) => {
        if (subItem.key === item) {
          itemArr.push(subItem);
        }
      });
    });
    return itemArr;
  };

  handleShelf(items: any, shelfTitle: string) {
    if (!shelfTitle) return items;
    let currentShelfTitle = shelfTitle;
    let currentShelfList = ConfigService.getMapConfig(
      currentShelfTitle,
      "shelfList"
    );
    let shelfItems = items.filter((item: { key: number }) => {
      return currentShelfList.indexOf(item.key) > -1;
    });
    return shelfItems;
  }

  //get the searched books according to the index
  handleIndexFilter = (items: any, arr: number[]) => {
    let itemArr: any[] = [];
    arr.forEach((item) => {
      items[item] && itemArr.push(items[item]);
    });
    return itemArr;
  };
  handleFilterShelfBook = (items: BookModel[]) => {
    return items.filter((item) => {
      return (
        ConfigService.getFromAllMapConfig(item.key, "shelfList").length === 0
      );
    });
  };
  handleCardScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const scale = parseFloat(e.target.value);
    this.setState({ cardScale: scale });
    ConfigService.setReaderConfig("cardScale", String(scale));
  };

  filterBooksByReadingStatus = (books: Book[], status: string): Book[] => {
    if (!status) return books;
    return books.filter((book) => {
      const record = ConfigService.getObjectConfig(
        book.key,
        "recordLocation",
        {}
      );
      const percentage: string =
        record && record.percentage ? record.percentage : "";
      if (status === "unread") {
        return !percentage || percentage === "0";
      } else if (status === "reading") {
        return percentage && percentage !== "0" && percentage !== "1";
      } else if (status === "finished") {
        return percentage === "1";
      }
      return true;
    });
  };

  parseBookTags = (value: string | undefined): string[] => {
    if (!value) {
      return [];
    }
    return value
      .split(/[,，、/|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  };

  filterBooksByTag = (books: Book[], tag: string): Book[] => {
    if (!tag) {
      return books;
    }
    return books.filter((book) => this.parseBookTags(book.tags).includes(tag));
  };

  getTagStats = (books: Book[]): TagStat[] => {
    const counts = new Map<string, number>();
    books.forEach((book) => {
      this.parseBookTags(book.tags).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name, "zh-CN")));
  };

  handleTagFilterChange = (tag: string) => {
    this.setState({
      tagFilter: this.state.tagFilter === tag ? "" : tag,
    });
  };

  renderBookList = (books: Book[], bookMode: string) => {
    if (books.length === 0 && !this.props.isSearch) {
      return <Redirect to="/manager/empty" />;
    }
    if (bookMode !== currentBookMode) {
      currentBookMode = bookMode;
    }

    // 使用状态中已加载的完整书籍数据，并按当前过滤后的 books 顺序/范围进行裁剪
    const filteredKeys = new Set(books.map((b) => b.key));
    const displayedBooks = DatabaseService.isServerMode()
      ? books
      : this.props.isSearch
        ? books
        : this.state.fullBooksData.filter((b) => filteredKeys.has(b.key));

    return displayedBooks.map((item: BookModel, index: number) => {
      return this.props.viewMode === "list" ? (
        <BookListItem
          key={item.key}
          {...({
            book: item,
            isSelected: this.props.selectedBooks.indexOf(item.key) > -1,
            allBooks: displayedBooks,
            bookIndex: index,
          } as any)}
        />
      ) : this.props.viewMode === "card" ? (
        <BookCardItem
          key={item.key}
          {...({
            book: item,
            cardScale: this.state.cardScale,
            isSelected: this.props.selectedBooks.indexOf(item.key) > -1,
            allBooks: displayedBooks,
            bookIndex: index,
          } as any)}
        />
      ) : (
        <BookCoverItem
          key={item.key}
          {...({
            book: item,
            isSelected: this.props.selectedBooks.indexOf(item.key) > -1,
            allBooks: displayedBooks,
            bookIndex: index,
          } as any)}
        />
      );
    });
  };
  handleBooks = () => {
    let bookMode = this.props.isSearch
      ? "search"
      : this.props.shelfTitle
        ? "shelf"
        : this.props.mode === "favorite"
          ? "favorite"
          : this.state.isHideShelfBook
            ? "hide"
            : "home";
    const serverHomeBooks =
      DatabaseService.isServerMode() &&
      !this.props.isSearch &&
      !this.props.shelfTitle &&
      this.props.mode !== "favorite" &&
      !this.state.isHideShelfBook
        ? this.props.books
        : null;
    let books =
      bookMode === "search"
        ? this.props.searchResults
        : bookMode === "shelf"
          ? this.handleShelf(serverHomeBooks || this.props.books, this.props.shelfTitle)
          : bookMode === "favorite"
            ? this.handleKeyFilter(
                serverHomeBooks || this.props.books,
                ConfigService.getAllListConfig("favoriteBooks")
              )
            : bookMode === "hide"
              ? this.handleFilterShelfBook((serverHomeBooks || this.props.books) as BookModel[])
              : serverHomeBooks || this.props.books;
    if (
      bookMode === "home" &&
      this.state.tagFilter &&
      !DatabaseService.isServerMode()
    ) {
      books = this.filterBooksByTag(books, this.state.tagFilter);
    }
    if (this.state.readingStatusFilter) {
      books = this.filterBooksByReadingStatus(
        books,
        this.state.readingStatusFilter
      );
    }
    const topBookKeys: string[] = ConfigService.getAllListConfig("topBooks");
    if (topBookKeys.length > 0) {
      const topSet = new Set(topBookKeys);
      const topBooks = [...topBookKeys]
        .map((key) => books.find((b) => b.key === key))
        .filter(Boolean) as Book[];
      const restBooks = books.filter((b) => !topSet.has(b.key));
      books = [...topBooks, ...restBooks];
    }
    return {
      books,
      bookMode,
    };
  };

  render() {
    if (!this.props.books) {
      return (
        <div className="book-list-loading" role="status">
          正在加载书库...
        </div>
      );
    }
    if (
      (this.state.favoriteBooks === 0 && this.props.mode === "favorite") ||
      !this.props.books[0]
    ) {
      return <Redirect to="/manager/empty" />;
    }
    const { books, bookMode } = this.handleBooks();
    const isServerMainLibraryMode =
      DatabaseService.isServerMode() &&
      !this.props.isSearch &&
      !this.props.shelfTitle &&
      this.props.mode !== "favorite";
    const pageSize = this.props.booksPageSize || 24;
    const totalBooks = DatabaseService.isServerMode()
      ? this.props.totalBooksCount || books.length
      : books.length;
    const totalPages = Math.max(
      1,
      Math.ceil(totalBooks / pageSize)
    );
    const currentPage = this.props.booksPage || 1;
    const pagedBooks = books;
    const tagStats = this.state.tagStats;
    const hasTagPanel = isServerMainLibraryMode && tagStats.length > 0;
    const containerStyle = {
      ...(this.props.isCollapsed
        ? { width: "calc(100vw - 70px)", left: "70px" }
        : {}),
      ...(hasTagPanel ? { top: "124px", height: "calc(100% - 124px)" } : {}),
    };
    return (
      <>
        <div
          className="book-list-header"
          style={
            this.props.isCollapsed
              ? { width: "calc(100% - 70px)", left: "70px" }
              : {}
          }
        >
          <SelectBook />

          <div
            style={this.props.isSelectBook ? { display: "none" } : {}}
            className="book-list-header-right"
          >
            {this.props.viewMode === "card" && (
              <input
                type="range"
                min="0.6"
                max="2"
                step="0.05"
                value={this.state.cardScale}
                onChange={this.handleCardScaleChange}
                className="book-card-scale-slider"
                title="调整封面大小"
              />
            )}
            <div className="book-list-total-page">
              共 {totalBooks} 本书
            </div>
            <select
              className="lang-setting-dropdown"
              value={this.state.readingStatusFilter}
              onChange={(e) => {
                this.setState({ readingStatusFilter: e.target.value });
              }}
              style={{ marginRight: "10px", width: "70px", borderWidth: "0px" }}
            >
              <option value="" className="lang-setting-option">
                全部
              </option>
              <option value="unread" className="lang-setting-option">
                未读
              </option>
              <option value="reading" className="lang-setting-option">
                阅读中
              </option>
              <option value="finished" className="lang-setting-option">
                已读完
              </option>
            </select>
            <ViewMode />
          </div>
        </div>
        {hasTagPanel && (
          <div
            className="book-list-tag-panel"
            style={
              this.props.isCollapsed
                ? { width: "calc(100% - 70px)", left: "70px" }
                : {}
            }
          >
            <div className="book-list-tag-filters">
              <button
                type="button"
                className={`book-list-tag-chip ${this.state.tagFilter ? "" : "active"}`}
                onClick={() => this.setState({ tagFilter: "" })}
              >
                全部标签
                <span>{this.state.totalTagBooks || totalBooks}</span>
              </button>
              {tagStats.map((tag) => (
                <button
                  key={tag.name}
                  type="button"
                  className={`book-list-tag-chip ${
                    this.state.tagFilter === tag.name ? "active" : ""
                  }`}
                  onClick={() => this.handleTagFilterChange(tag.name)}
                >
                  {tag.name}
                  <span>{tag.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          className="book-list-container-parent"
          style={containerStyle}
        >
          <div className="book-list-container">
            <ul
              className="book-list-item-box"
              ref={this.scrollContainer}
              data-view-mode={this.props.viewMode}
              style={
                { "--card-scale": this.state.cardScale } as React.CSSProperties
              }
            >
              {this.renderBookList(pagedBooks, bookMode)}
            </ul>
          </div>
          {DatabaseService.isServerMode() && !this.props.isSearch && (
            <div
              className="server-books-pagination"
            >
              <button
                type="button"
                className="detail-dialog-server-secondary"
                disabled={currentPage <= 1}
                onClick={() => {
                  this.props.handleFetchBooks(
                    Math.max(1, currentPage - 1),
                    this.props.booksPageSize,
                    isServerMainLibraryMode ? this.state.tagFilter : undefined
                  );
                }}
              >
                上一页
              </button>
              <span style={{ color: "var(--text-color)", fontSize: "14px" }}>
                第 {currentPage} / {totalPages} 页
              </span>
              <button
                type="button"
                className="detail-dialog-server-primary"
                disabled={currentPage >= totalPages}
                onClick={() => {
                  this.props.handleFetchBooks(
                    Math.min(totalPages, currentPage + 1),
                    this.props.booksPageSize,
                    isServerMainLibraryMode ? this.state.tagFilter : undefined
                  );
                }}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </>
    );
  }
}

export default withRouter(BookList as any);
