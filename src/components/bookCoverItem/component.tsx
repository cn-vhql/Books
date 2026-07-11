import React, { useMemo } from "react";
import "./bookCoverItem.css";
import { BookCoverProps } from "./interface";
import ActionDialog from "../dialogs/actionDialog";
import { withRouter } from "react-router-dom";
import EmptyCover from "../emptyCover";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { useBookItem } from "../bookItem/useBookItem";
import { getFileNameWithoutExtension } from "../../utils/common";

declare var window: any;

const BookCoverItem: React.FC<BookCoverProps> = (props) => {
  const {
    left,
    setLeft,
    top,
    setTop,
    direction,
    setDirection,
    isHover,
    setIsHover,
    cover,
    setCover,
    isCoverExist,
    setIsCoverExist,
    isBookOffline,
    handleJump,
    handleSelectIconClick,
    handleBookDragStart,
    getPercentage,
    isFavoriteBook,
    isTopBook,
    setIsFavorite,
  } = useBookItem(props);

  const handleMoreAction = (event: any) => {
    event.preventDefault();
    const e = event || window.event;
    let x = e.clientX;
    if (x > document.body.clientWidth - 300 && !props.isCollapsed) {
      x = x - 180;
    }
    setLeft(x);
    setTop(
      document.body.clientHeight - e.clientY > 250 ? e.clientY : e.clientY - 200
    );
    props.handleActionDialog(true);
    props.handleReadingBook(props.book);
  };

  const percentage = getPercentage();

  const textContent = useMemo(() => {
    const htmlString = props.book.description || "";
    return htmlString
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }, [props.book.description]);

  const actionProps = { left, top };

  return (
    <>
      <div
        className="book-list-cover-item"
        draggable
        onDragStart={handleBookDragStart}
        onContextMenu={(event) => {
          handleMoreAction(event);
        }}
      >
        <div className="book-cover-item-header">
          <div className="reading-progress-icon">
            <div style={{ position: "relative", left: "4px" }}>
              {percentage && !isNaN(parseFloat(percentage))
                ? percentage === "0"
                  ? "新书"
                  : percentage === "1"
                    ? "读完"
                    : (parseFloat(percentage) * 100).toFixed(2)
                : "0"}
              {percentage &&
                !isNaN(parseFloat(percentage)) &&
                percentage !== "0" &&
                percentage !== "1" && <span>%</span>}
            </div>
          </div>
          <span
            className="icon-more book-more-action"
            onClick={(event) => {
              handleMoreAction(event);
            }}
          ></span>
          {(isFavoriteBook() || isTopBook()) && (
            <span className="book-cover-status-actions">
              {isFavoriteBook() && (
                <span className="icon-heart book-heart-action"></span>
              )}
              {isTopBook() && (
                <span className="icon-pin book-top-action"></span>
              )}
            </span>
          )}
        </div>

        <div
          className="book-cover-item-cover"
          onClick={(event) => {
            handleJump(event);
          }}
          onMouseEnter={() => {
            setIsHover(true);
          }}
          onMouseLeave={() => {
            setIsHover(false);
          }}
          style={
            ConfigService.getReaderConfig("isDisableCrop") === "yes"
              ? {
                  height: "195px",
                  alignItems: "flex-start",
                  background: "rgba(255, 255,255, 0)",
                  boxShadow: "0px 0px 5px rgba(0, 0, 0, 0)",
                }
              : {
                  height: "170px",
                  alignItems: "center",
                  overflow: "hidden",
                }
          }
        >
          {!isCoverExist ||
          (props.book.format === "PDF" &&
            ConfigService.getReaderConfig("isDisablePDFCover") === "yes") ? (
            <div
              className="book-item-image"
              style={{ width: "120px", height: "170px" }}
            >
              <EmptyCover
                {...{
                  format: props.book.format,
                  title:
                    ConfigService.getReaderConfig("isUseOriginalName") === "yes"
                      ? getFileNameWithoutExtension(
                          props.book.path,
                          props.book.name
                        )
                      : props.book.name,
                  scale: 1.14,
                }}
              />
            </div>
          ) : (
            <img
              src={cover}
              alt=""
              loading="lazy"
              draggable={false}
              style={
                direction === "horizontal" ||
                ConfigService.getReaderConfig("isDisableCrop") === "yes"
                  ? { width: "100%" }
                  : { height: "100%" }
              }
              className="book-item-image"
              onLoad={(res: any) => {
                if (
                  res.target.naturalHeight / res.target.naturalWidth >
                  170 / 120
                ) {
                  setDirection("horizontal");
                } else {
                  setDirection("vertical");
                }
              }}
              onError={() => {
                setCover("");
                setIsCoverExist(false);
              }}
            />
          )}
          {props.isSelectBook || isHover ? (
            <span
              className="icon-message book-selected-icon"
              onMouseEnter={() => {
                setIsHover(true);
              }}
              onClick={(event) => {
                handleSelectIconClick(event);
              }}
              style={
                props.isSelected
                  ? {
                      right: "272px",
                      top: "30px",
                      opacity: 1,
                    }
                  : {
                      right: "272px",
                      top: "30px",
                      color: "#eee",
                    }
              }
            ></span>
          ) : null}
        </div>

        <p className="book-cover-item-title">
          {!isBookOffline && (
            <span
              className="icon-cloud book-download-action"
              style={{ fontWeight: "bold" }}
            ></span>
          )}
          {ConfigService.getReaderConfig("isUseOriginalName") === "yes"
            ? getFileNameWithoutExtension(props.book.path, props.book.name)
            : props.book.name}
        </p>
        <p className="book-cover-item-author">
          作者：&nbsp;
          <Trans>{props.book.author || "未知作者"}</Trans>
        </p>
        <p className="book-cover-item-author">
          出版社：&nbsp;
          <Trans>{props.book.publisher}</Trans>
        </p>
        <div className="book-cover-item-desc">
          简介：&nbsp;
          <div className="book-cover-item-desc-detail">
            {props.book.description ? textContent : "暂无简介"}
          </div>
        </div>
      </div>
      {props.isOpenActionDialog && props.book.key === props.currentBook.key ? (
        <ActionDialog {...(actionProps as any)} />
      ) : null}
    </>
  );
};

export default withRouter(BookCoverItem as any);
