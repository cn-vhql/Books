import React from "react";
import "./updateInfo.css";
import { DetailDialogProps, DetailDialogState } from "./interface";
import { Trans } from "react-i18next";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import EmptyCover from "../../emptyCover";
import CoverUtil from "../../../utils/file/coverUtil";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import toast from "react-hot-toast";
import DatabaseService from "../../../utils/storage/databaseService";
import ServerLibrary from "../../../utils/storage/serverLibrary";
import BookUtil from "../../../utils/file/bookUtil";
import { getFileNameWithoutExtension } from "../../../utils/common";
class DetailDialog extends React.Component<
  DetailDialogProps,
  DetailDialogState
> {
  constructor(props: DetailDialogProps) {
    super(props);
    this.state = {
      backgroundColor: "#333",
      textColor: "#333",
      cover: "",
      isCoverExist: false,
      shelfLocation: [],
      bookDetails: null,
      permissions: [],
      metadataResults: [],
      metadataLoading: false,
      metadataApplyingKey: "",
      activeTab: "overview",
      notes: [],
      isEditing: false,
    };
  }
  async componentDidMount() {
    const shelfList = ConfigService.getAllMapConfig("shelfList");
    const shelfLocation: string[] = [];
    for (let shelf in shelfList) {
      if (shelfList[shelf].indexOf(this.props.currentBook.key) > -1) {
        shelfLocation.push(shelf);
      }
    }
    this.setState({ shelfLocation });

    Promise.all([
      CoverUtil.getCover(this.props.currentBook),
      CoverUtil.isCoverExist(this.props.currentBook),
    ])
      .then(([cover, isCoverExist]) => {
        this.setState({ cover, isCoverExist });
      })
      .catch((error) => {
        console.error(error);
      });

    this.loadNotes();
    if (this.props.isServerMode) {
      this.loadServerBookDetails();
    }
  }
  loadNotes = async () => {
    try {
      const notes = await DatabaseService.getRecordsByBookKey(
        this.props.currentBook.key,
        "notes"
      );
      notes.sort((a: any, b: any) => parseInt(b.key) - parseInt(a.key));
      this.setState({ notes });
    } catch (error) {
      console.error(error);
    }
  };
  loadServerBookDetails = async () => {
    try {
      const response = await ServerLibrary.getBook(this.props.currentBook.key);
      this.setState({
        bookDetails: response.book,
        permissions: response.permissions || [],
      });
    } catch (error) {
      console.error(error);
      toast.error("加载图书详情失败");
    }
  };
  handleClose = () => {
    this.props.handleDetailDialog(false);
  };
  handleRead = () => {
    this.props.handleReadingBook(this.props.currentBook);
    this.handleClose();
    BookUtil.redirectBook(this.props.currentBook);
  };
  handleDownload = async () => {
    try {
      const book = this.state.bookDetails || this.props.currentBook;
      const buffer = await ServerLibrary.fetchBookBuffer(book.key, book.format);
      const blob = new Blob([buffer]);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const extension = (book.format || "").toLowerCase();
      link.href = url;
      link.download = `${book.name || book.key}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "下载失败";
      toast.error(message);
    }
  };
  updateBookField = (field: string, value: any) => {
    this.setState((prevState) => ({
      bookDetails: {
        ...(prevState.bookDetails || this.props.currentBook),
        [field]: value,
      },
    }));
  };
  getRoleLabel = (role?: string) => {
    if (role === "admin") {
      return "管理员";
    }
    if (role === "user") {
      return "普通用户";
    }
    return role || "-";
  };
  handleDoubanSearch = async () => {
    const book = this.state.bookDetails || this.props.currentBook;
    const query = [book.name || "", book.author || ""].filter(Boolean).join(" ");
    if (!query.trim() && !book.isbn) {
      toast.error("缺少查询信息");
      return;
    }
    this.setState({ metadataLoading: true, isEditing: true });
    try {
      let results: any[] = [];
      if (book.isbn) {
        const response = await ServerLibrary.getMetadataByISBN(book.isbn);
        if (response?.data) {
          results = [
            {
              ...response.data,
              key: response.data.key || response.data.doubanId || book.key,
              page: (response.data as any).page || "",
              price: (response.data as any).price || "",
              binding: (response.data as any).binding || "",
            },
          ];
        }
      }
      if (!results.length && query.trim()) {
        const response = await ServerLibrary.searchMetadata(
          book.name || "",
          book.author || ""
        );
        results = Array.isArray(response?.data)
          ? response.data.map((item: any) => ({
              ...item,
              page: item.page || "",
              price: item.price || "",
              binding: item.binding || "",
            }))
          : [];
      }
      this.setState({ metadataResults: results, isEditing: true });
      if (!results.length) {
        toast.error("没有找到匹配结果，请尝试精简书名或补充 ISBN");
      }
    } catch (error) {
      console.error(error);
      toast.error("获取元信息失败");
    } finally {
      this.setState({ metadataLoading: false });
    }
  };
  handleMetadataSearch = async () => {
    const book = this.state.bookDetails || this.props.currentBook;
    this.setState({ metadataLoading: true, isEditing: true });
    try {
      const response = await ServerLibrary.searchMetadata(
        book.name || "",
        book.author || ""
      );
      this.setState({ metadataResults: response.data || [] });
    } catch (error) {
      console.error(error);
      toast.error("搜索元信息失败");
    } finally {
      this.setState({ metadataLoading: false });
    }
  };
  applyMetadataResult = (item: any) => {
    this.setState((prevState) => ({
      bookDetails: {
        ...(prevState.bookDetails || this.props.currentBook),
        name: item.name || prevState.bookDetails?.name,
        author: item.author || prevState.bookDetails?.author,
        publisher: item.publisher || "",
        description: item.description || "",
        isbn: item.isbn || "",
        doubanId: item.doubanId || "",
        publishedAt: item.publishedAt || "",
        source: item.source || "",
        sourceUrl: item.sourceUrl || "",
        rating: item.rating || "",
        cover: item.cover || prevState.bookDetails?.cover || "",
      },
    }));
  };
  applyDoubanMetadata = async (item: any) => {
    if (!item?.key) {
      this.applyMetadataResult(item);
      return;
    }
    this.setState({ metadataApplyingKey: item.key });
    try {
      const response = await ServerLibrary.getMetadataDetail(
        item.source || "Douban",
        item.key
      );
      const payload = response.data || {};
      const detailItem = {
        key: payload.key || item.key,
        name: payload.name || item.name,
        author: payload.author || item.author || "",
        publisher: payload.publisher || item.publisher || "",
        description: payload.description || item.description || "",
        cover: payload.cover || item.cover || "",
        isbn: payload.isbn || item.isbn || "",
        doubanId: payload.doubanId || item.doubanId || "",
        publishedAt: payload.publishedAt || item.publishedAt || "",
        rating: payload.rating || item.rating || "",
        source: payload.source || item.source || "Douban",
        sourceUrl: payload.sourceUrl || item.sourceUrl || "",
        page: (payload as any).page || item.page || "",
        price: (payload as any).price || item.price || "",
        binding: (payload as any).binding || item.binding || "",
      };
      this.applyMetadataResult(detailItem);
      toast.success("已应用所选元信息");
    } catch (error) {
      console.error(error);
      this.applyMetadataResult(item);
      toast.error("获取完整元信息失败，已应用搜索结果");
    } finally {
      this.setState({ metadataApplyingKey: "" });
    }
  };
  saveServerBook = async () => {
    const book = this.state.bookDetails;
    if (!book) {
      return;
    }
    try {
      await ServerLibrary.updateBook({
        ...this.props.currentBook,
        ...book,
        permissions: this.state.permissions,
      } as any);
      toast.success("保存成功");
      this.props.handleFetchBooks();
      await this.loadServerBookDetails();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "更新失败";
      toast.error(message);
    }
  };
  savePermissions = async () => {
    try {
      await ServerLibrary.updateBookPermissions(
        this.props.currentBook.key,
        this.state.permissions || []
      );
      toast.success("权限已保存");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "更新失败";
      toast.error(message);
    }
  };
  handleShelfClick = (shelfTitle: string) => {
    this.props.handleDetailDialog(false);
    this.props.handleShelf(shelfTitle);
    this.props.handleMode("shelf");
    this.props.history.push("/manager/shelf");
  };
  render() {
    if (this.props.isServerMode) {
      const book = this.state.bookDetails || this.props.currentBook;
      const isAdmin = this.props.currentUser?.role === "admin";
      const notes = this.state.notes || [];
      return (
        <div className="download-desk-container detail-dialog-server-container">
          <div className="detail-dialog-server-shell">
            <div className="detail-dialog-server-head">
              <div className="detail-dialog-server-topline">
                <div className="detail-dialog-server-titles">
                  <p className="detail-dialog-server-title">{book.name}</p>
                  <p className="detail-dialog-server-author">
                    <Trans>{book.author || "未知作者"}</Trans>
                  </p>
                </div>
                <div className="detail-dialog-server-top-actions">
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        className="detail-dialog-server-header-button"
                        onClick={this.handleDoubanSearch}
                      >
                        豆瓣
                      </button>
                      <button
                        type="button"
                        className={`detail-dialog-server-header-button ${
                          this.state.isEditing ? "active" : ""
                        }`}
                        onClick={() =>
                          this.setState({
                            isEditing: !this.state.isEditing,
                          })
                        }
                      >
                        编辑
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="detail-dialog-server-close-icon"
                    onClick={this.handleClose}
                    aria-label="关闭"
                    title="关闭"
                  >
                    <span className="icon-close"></span>
                  </button>
                </div>
              </div>
              <div className="detail-dialog-server-hero">
                <div className="detail-dialog-server-coverbox">
                  {this.state.isCoverExist ? (
                    <img
                      src={this.state.cover}
                      alt=""
                      className="detail-dialog-server-cover"
                      onError={() =>
                        this.setState({ cover: "", isCoverExist: false })
                      }
                    />
                  ) : (
                    <div className="detail-dialog-server-cover detail-dialog-server-cover-fallback">
                      <EmptyCover
                        {...{
                          format: book.format,
                          title:
                            book.name ||
                            getFileNameWithoutExtension(book.path, book.name),
                          scale: 1.35,
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="detail-dialog-server-summary">
                  <div className="detail-dialog-server-meta-grid">
                    <div className="detail-dialog-server-meta-item">
                      <span>出版社</span>
                      <strong>{book.publisher || "-"}</strong>
                    </div>
                    <div className="detail-dialog-server-meta-item">
                      <span>格式</span>
                      <strong>{book.format || "-"}</strong>
                    </div>
                    <div className="detail-dialog-server-meta-item">
                      <span>{this.props.t("ISBN")}</span>
                      <strong>{book.isbn || "-"}</strong>
                    </div>
                    <div className="detail-dialog-server-meta-item">
                      <span>笔记</span>
                      <strong>{notes.length}</strong>
                    </div>
                  </div>
                  <div className="detail-dialog-server-actions">
                    <button
                      type="button"
                      className="detail-dialog-server-primary"
                      onClick={this.handleRead}
                    >
                      阅读
                    </button>
                    <button
                      type="button"
                      className="detail-dialog-server-secondary"
                      onClick={this.handleDownload}
                    >
                      下载
                    </button>
                  </div>
                  <div className="detail-dialog-server-desc">
                    {book.description ? (
                      Parser(DOMPurify.sanitize(book.description))
                    ) : (
                      <span>暂无简介</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="detail-dialog-server-tabs">
              <button
                type="button"
                className={`detail-dialog-server-tab ${
                  this.state.activeTab === "overview" ? "active" : ""
                }`}
                onClick={() => this.setState({ activeTab: "overview" })}
              >
                概览
              </button>
              <button
                type="button"
                className={`detail-dialog-server-tab ${
                  this.state.activeTab === "notes" ? "active" : ""
                }`}
                onClick={() => this.setState({ activeTab: "notes" })}
              >
                笔记
              </button>
            </div>

            <div className="detail-dialog-server-body">
              {this.state.activeTab === "notes" ? (
                <div className="detail-dialog-server-notes">
                  {notes.length > 0 ? (
                    notes.map((note: any) => (
                      <div key={note.key} className="detail-dialog-server-note-card">
                        <div className="detail-dialog-server-note-top">
                          <span>{note.chapter || "未知章节"}</span>
                          <span>{note.percentage || "-"}</span>
                        </div>
                        <div className="detail-dialog-server-note-quote">
                          {note.text || "-"}
                        </div>
                        {note.notes ? (
                          <div className="detail-dialog-server-note-text">
                            {note.notes}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="detail-dialog-server-empty">暂无笔记</div>
                  )}
                </div>
              ) : (
                <div className="detail-dialog-server-overview">
                  <div className="detail-dialog-server-section">
                    <div className="detail-dialog-server-section-title">
                      内容简介
                    </div>
                    <div className="detail-dialog-server-section-content">
                      {book.description ? (
                        Parser(DOMPurify.sanitize(book.description))
                      ) : (
                        <span>暂无简介</span>
                      )}
                    </div>
                  </div>
                  {isAdmin && this.state.isEditing && (
                    <>
                      <div className="detail-dialog-server-section">
                        <div className="detail-dialog-server-section-title">
                          图书元信息
                        </div>
                        <div className="detail-dialog-server-form-grid">
                          <input
                            className="detail-dialog-server-input"
                            value={book.name || ""}
                            placeholder="书名"
                            onChange={(event) =>
                              this.updateBookField("name", event.target.value)
                            }
                          />
                          <input
                            className="detail-dialog-server-input"
                            value={book.author || ""}
                            placeholder="作者"
                            onChange={(event) =>
                              this.updateBookField("author", event.target.value)
                            }
                          />
                          <input
                            className="detail-dialog-server-input"
                            value={book.publisher || ""}
                            placeholder="出版社"
                            onChange={(event) =>
                              this.updateBookField(
                                "publisher",
                                event.target.value
                              )
                            }
                          />
                        </div>
                        <textarea
                          className="detail-dialog-server-textarea"
                          value={book.description || ""}
                          placeholder="简介"
                          onChange={(event) =>
                            this.updateBookField(
                              "description",
                              event.target.value
                            )
                          }
                        />
                        <div className="detail-dialog-server-inline-actions">
                          <button
                            type="button"
                            className="detail-dialog-server-secondary"
                            onClick={this.handleMetadataSearch}
                          >
                            {this.state.metadataLoading ? "搜索中" : "搜索元信息"}
                          </button>
                          <button
                            type="button"
                            className="detail-dialog-server-primary"
                            onClick={this.saveServerBook}
                          >
                            保存
                          </button>
                        </div>
                        {this.state.metadataResults &&
                        this.state.metadataResults.length > 0 ? (
                          <div className="detail-dialog-server-result-list">
                            {this.state.metadataResults.map((item: any) => (
                              <div
                                key={item.key}
                                className="detail-dialog-server-result-item"
                              >
                                <div>
                                  <div className="detail-dialog-server-result-title">
                                    {item.name}
                                  </div>
                                  <div className="detail-dialog-server-result-meta">
                                    {item.author}
                                    {item.source ? ` · ${item.source === "Douban" ? "豆瓣" : item.source}` : ""}
                                  </div>
                                  <div className="detail-dialog-server-result-extra">
                                    {[item.publisher, item.publishedAt, item.rating ? `评分 ${item.rating}` : ""]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                  {item.description ? (
                                    <div className="detail-dialog-server-result-desc">
                                      {item.description}
                                    </div>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  className="detail-dialog-server-secondary"
                                  onClick={() =>
                                    item.source === "Douban"
                                      ? this.applyDoubanMetadata(item)
                                      : this.applyMetadataResult(item)
                                  }
                                >
                                  {this.state.metadataApplyingKey === item.key
                                    ? "应用中"
                                    : "应用此条"}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="detail-dialog-server-section">
                        <div className="detail-dialog-server-section-title">
                          可见用户
                        </div>
                        <textarea
                          className="detail-dialog-server-textarea"
                          value={(this.state.permissions || []).join(", ")}
                          placeholder="留空表示所有用户可见，多个用户请用英文逗号分隔"
                          onChange={(event) =>
                            this.setState({
                              permissions: event.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                        <div className="detail-dialog-server-inline-actions">
                          <button
                            type="button"
                            className="detail-dialog-server-primary"
                            onClick={this.savePermissions}
                          >
                            保存权限
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    const renderShelfLocation = (shelfLocation: string[]) => {
      return shelfLocation.map((item: any, index: number) => {
        return (
          <li
            key={item}
            className={"tag-list-item"}
            style={{ borderWidth: 1.5 }}
            onClick={() => {
              this.handleShelfClick(item);
            }}
          >
            <div className="center">
              <Trans>{item}</Trans>
            </div>
          </li>
        );
      });
    };
    return (
      <div className="download-desk-container">
        <div
          className="detail-dialog-book-info"
          style={{
            paddingTop: "20",
            paddingBottom: "20",
            height: "430px",
          }}
        >
          <div style={{ position: "relative" }}>
            <div className="detail-cover-container">
              {this.state.isCoverExist ? (
                <img src={this.state.cover} alt="" className="detail-cover" />
              ) : (
                <div
                  className="detail-cover"
                  style={{ width: "125px", height: "170px" }}
                >
                  <EmptyCover
                    {...{
                      format: this.props.currentBook.format,
                      title: this.props.currentBook.name,
                      scale: 1.2,
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <p className="detail-dialog-book-title">
            {this.props.currentBook.name}
          </p>
          <p className="detail-dialog-book-author">
            <Trans>{this.props.currentBook.author || "Unknown author"}</Trans>
          </p>

          <div className="detail-sub-info">
            <p className="detail-dialog-book-publisher">
              <p className="detail-sub-title">
                <Trans>Publisher</Trans>
              </p>
              <p className="detail-sub-content-container">
                <p className="detail-sub-content">
                  {this.props.currentBook.publisher}
                </p>
              </p>
            </p>
            <p
              className="detail-dialog-book-divider"
              style={{ backgroundColor: this.state.textColor }}
            ></p>
            <p className="detail-dialog-book-size">
              <p className="detail-sub-title">
                <Trans>File size</Trans>
              </p>
              <p className="detail-sub-content-container">
                <p className="detail-sub-content">
                  {this.props.currentBook.size
                    ? this.props.currentBook.size / 1024 / 1024 > 1
                      ? parseFloat(
                          this.props.currentBook.size / 1024 / 1024 + ""
                        ).toFixed(2) + "Mb"
                      : parseInt(this.props.currentBook.size / 1024 + "") + "Kb"
                    : // eslint-disable-next-line
                      "0" + "Kb"}
                </p>
              </p>
            </p>
            <p
              className="detail-dialog-book-divider"
              style={{ backgroundColor: this.state.textColor }}
            ></p>
            <p className="detail-dialog-book-added">
              <p className="detail-sub-title">
                <Trans>Added on</Trans>
              </p>
              <p className="detail-sub-content-container">
                <p className="detail-sub-content">
                  {new Date(parseInt(this.props.currentBook.key))
                    .toLocaleString()
                    .replace(/:\d{1,2}$/, " ")}
                </p>
              </p>
            </p>
            <p
              className="detail-dialog-book-divider"
              style={{ backgroundColor: this.state.textColor }}
            ></p>
            <p className="detail-dialog-book-added">
              <p className="detail-sub-title">
                <Trans>Format</Trans>
              </p>
              <p className="detail-sub-content-container">
                <p className="detail-sub-content">
                  {this.props.currentBook.format}
                </p>
              </p>
            </p>
          </div>
          {this.state.shelfLocation.length > 0 && (
            <div>
              <p className="detail-dialog-book-desc">
                <Trans>Shelf location</Trans>:
              </p>
              <div className="detail-dialog-shelf-location">
                {renderShelfLocation(this.state.shelfLocation)}
              </div>
            </div>
          )}
          <div>
            <p className="detail-dialog-book-desc">
              <Trans>Description</Trans>:
            </p>
            <div className="detail-dialog-book-detail">
              {this.props.currentBook.description ? (
                Parser(DOMPurify.sanitize(this.props.currentBook.description))
              ) : (
                <Trans>Empty</Trans>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            className="new-version-open"
            onClick={() => {
              this.handleClose();
            }}
            style={{ marginTop: "10px", position: "absolute", bottom: "10px" }}
          >
            <Trans>Close</Trans>
          </div>
        </div>
      </div>
    );
  }
}

export default DetailDialog;
