import BookModel from "../../../models/Book";
import { RouteComponentProps } from "react-router-dom";
export interface BookListProps extends RouteComponentProps<any> {
  books: BookModel[];
  mode: string;
  shelfTitle: string;
  searchResults: number[];
  isSearch: boolean;
  isCollapsed: boolean;
  booksPage: number;
  booksPageSize: number;
  totalBooksCount: number;
  isSelectBook: boolean;
  viewMode: string;
  selectedBooks: string[];

  bookSortCode: { sort: number; order: number };
  noteSortCode: { sort: number; order: number };
  handleAddDialog: (isShow: boolean) => void;
  handleMode: (mode: string) => void;
  handleFetchBooks: (page?: number, pageSize?: number, tag?: string) => void;
  handleShelf: (shelfTitle: string) => void;
  handleDeleteDialog: (isShow: boolean) => void;
  handleLoadMore: (isLoadMore: boolean) => void;
  t: (title: string) => string;
}
export interface BookListState {
  favoriteBooks: number;
  isHideShelfBook: boolean;
  displayedBooksCount: number;
  isLoadingMore: boolean;
  fullBooksData: BookModel[];
  cardScale: number;
  readingStatusFilter: string;
  tagFilter: string;
  serverPage: number;
  tagStats: { name: string; count: number }[];
  taggedBooksCount: number;
  totalTagBooks: number;
}
