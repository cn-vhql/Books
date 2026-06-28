export interface MetadataDialogProps {
  t: (title: string) => string;
  isAuthed: boolean;
  currentBookName: string;
  currentBookAuthor: string;
  handleSetting: (isSettingOpen: boolean) => void;
  handleSettingMode: (mode: string) => void;
  handleMetadataDialog: (isShow: boolean) => void;
  handleApplyMetadata: (metadata: MetadataResult) => void;
}

export interface MetadataResult {
  name?: string;
  author?: string;
  publisher?: string;
  description?: string;
  publishedDate?: string;
  cover?: string;
}

export interface CloudBookItem {
  key: string;
  name: string;
  author: string;
  publisher?: string;
  description?: string;
  cover?: string;
  source: string;
  isbn?: string;
  doubanId?: string;
  publishedAt?: string;
  rating?: string;
  sourceUrl?: string;
}

export type BookResultItem = CloudBookItem;

export interface MetadataDialogState {
  searchName: string;
  searchAuthor: string;
  results: BookResultItem[];
  selectedId: string | null;
  isLoading: boolean;
  error: string;
}
