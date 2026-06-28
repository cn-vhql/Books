import BookModel from "../../models/Book";
import { RouteComponentProps } from "react-router-dom";
export interface ImportLocalProps extends RouteComponentProps<any> {
  books: BookModel[];
  deletedBooks: BookModel[];

  isCollapsed: boolean;
  isAuthed: boolean;
  currentUser: any;
  mode: string;
  shelfTitle: string;
  cloudSyncFunc: () => Promise<void>;
  handleFetchBooks: () => void;
  handleDrag: (isDrag: boolean) => void;
  handleImportDialog: (isOpenImportDialog: boolean) => void;
  handleOPDSDialog: (isOpen: boolean) => void;
  handleImportBookFunc: (importBookFunc: (file: any) => Promise<void>) => void;
  handleReadingBook: (book: BookModel) => void;
  t: (title: string) => string;
}
export interface ImportLocalState {
  isOpenFile: boolean;
  isMoreOptionsVisible: boolean;
  width: number;
  importingShelfTitle: string;
}
