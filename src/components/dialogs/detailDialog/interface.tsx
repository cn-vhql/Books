import BookModel from "../../../models/Book";
import NoteModel from "../../../models/Note";
export interface DetailDialogProps {
  handleDetailDialog: (isDetailDialog: boolean) => void;
  handleShelf: (shelfTitle: string) => void;
  handleMode: (mode: string) => void;
  handleReadingBook: (book: BookModel) => void;
  history: any;
  currentBook: BookModel;
  currentUser: any;
  isServerMode: boolean;
  handleFetchBooks: () => void;
  t: (title: string) => string;
}
export interface DetailDialogState {
  backgroundColor: string;
  textColor: string;
  cover: string;
  isCoverExist: boolean;
  shelfLocation: string[];
  bookDetails?: any;
  permissions?: string[];
  metadataResults?: any[];
  metadataLoading?: boolean;
  metadataApplyingKey?: string;
  activeTab?: "overview" | "notes";
  notes?: NoteModel[];
  isEditing?: boolean;
}
