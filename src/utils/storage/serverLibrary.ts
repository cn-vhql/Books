import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import Book from "../../models/Book";

type RecordType = "notes" | "bookmarks" | "record_locations";

export interface ServerSessionUser {
  id: number;
  username: string;
  role: "admin" | "user";
  enabled?: boolean;
}

export interface ServerSessionState {
  authenticated: boolean;
  user?: ServerSessionUser;
}

export interface ServerBookDetailsResponse {
  book: Book;
  permissions: string[];
}

export interface ServerUserRecord extends ServerSessionUser {
  createdAt?: number;
  updatedAt?: number;
}

export interface ServerMetadataItem {
  key: string;
  name: string;
  author: string;
  publisher?: string;
  description?: string;
  cover?: string;
  isbn?: string;
  doubanId?: string;
  tags?: string;
  publishedAt?: string;
  rating?: string;
  source?: string;
  sourceUrl?: string;
}

export interface ServerMetadataDetailResponse {
  code: number;
  data: ServerMetadataItem;
}

export interface ServerBooksPageResponse {
  items: Book[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ServerBookTagStat {
  name: string;
  count: number;
}

export interface ServerBookTagsResponse {
  items: ServerBookTagStat[];
  totalTags: number;
  taggedBooksCount: number;
  totalBooks: number;
}

export interface ServerBooksQueryOptions {
  page?: number;
  pageSize?: number;
  query?: string;
  tag?: string;
  sort?: string;
  order?: string;
}

class ServerLibrary {
  private static coverUrlCache = new Map<string, string>();
  private static coverBlobUrlCache = new Map<string, string>();
  private static sessionStateCache: ServerSessionState | null = null;

  private static getBaseUrl() {
    return "";
  }

  static isEnabled() {
    return (
      ConfigService.getReaderConfig("libraryMode") === "server" &&
      typeof window !== "undefined"
    );
  }

  private static getFallbackAuthHeaders(): Record<string, string> {
    const username = ConfigService.getReaderConfig("libraryUsername") || "";
    const password = ConfigService.getReaderConfig("libraryPassword") || "";
    if (!username || !password) {
      return {};
    }
    return {
      Authorization: `Basic ${window.btoa(`${username}:${password}`)}`,
    };
  }

  private static async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...this.getFallbackAuthHeaders(),
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...((init.headers as Record<string, string>) || {}),
    };
    const response = await fetch(`${this.getBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json();
  }

  static async getBooks(options: ServerBooksQueryOptions = {}) {
    const {
      page = 1,
      pageSize = 24,
      query = "",
      tag = "",
      sort = "",
      order = "",
    } = options;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (query) {
      params.set("q", query);
    }
    if (tag) {
      params.set("tag", tag);
    }
    if (sort) {
      params.set("sort", sort);
    }
    if (order) {
      params.set("order", order);
    }
    return this.request<ServerBooksPageResponse>(
      `/api/library/books?${params.toString()}`
    );
  }

  static async getTags() {
    return this.request<ServerBookTagsResponse>("/api/library/tags");
  }

  static async listAllBooks(options: Omit<ServerBooksQueryOptions, "page"> = {}) {
    const pageSize = Math.min(options.pageSize || 200, 200);
    let page = 1;
    let total = 0;
    const books: Book[] = [];

    do {
      const response = await this.getBooks({
        ...options,
        page,
        pageSize,
      });
      books.push(...(response.items || []));
      total = response.total || books.length;
      page += 1;
    } while (books.length < total);

    return books;
  }

  static async getBook(key: string) {
    return this.request<ServerBookDetailsResponse>(`/api/library/books/${key}`);
  }

  static async saveBook(book: Book, file?: Blob, cover?: Blob) {
    const formData = new FormData();
    formData.append("metadata", JSON.stringify(book));
    if (file) {
      formData.append("file", file, `${book.key}.${book.format.toLowerCase()}`);
    }
    if (cover) {
      formData.append("cover", cover, `${book.key}.jpg`);
    }
    return this.request<Book>("/api/library/books", {
      method: "POST",
      body: formData,
    });
  }

  static async updateBook(book: Book) {
    this.invalidateCoverUrl(book.key);
    return this.request<Book>(`/api/library/books/${book.key}`, {
      method: "PUT",
      body: JSON.stringify(book),
    });
  }

  static async deleteBook(key: string) {
    this.invalidateCoverUrl(key);
    return this.request<{ success: boolean }>(`/api/library/books/${key}`, {
      method: "DELETE",
    });
  }

  static async getBookPermissions(key: string) {
    return this.request<{ users: string[] }>(
      `/api/library/books/${key}/permissions`
    );
  }

  static async updateBookPermissions(key: string, users: string[]) {
    return this.request<{ success: boolean; users: string[] }>(
      `/api/library/books/${key}/permissions`,
      {
        method: "PUT",
        body: JSON.stringify({ users }),
      }
    );
  }

  static async fetchBookBuffer(key: string, format: string) {
    const response = await fetch(
      `${this.getBaseUrl()}/api/library/books/${key}/file`,
      {
        credentials: "include",
        headers: this.getFallbackAuthHeaders(),
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  }

  static async fetchCoverBlobUrl(key: string) {
    const cached = this.coverBlobUrlCache.get(key);
    if (cached) {
      return cached;
    }
    const response = await fetch(
      `${this.getBaseUrl()}/api/library/books/${key}/cover?t=${Date.now()}`,
      {
        credentials: "include",
        cache: "no-store",
        headers: this.getFallbackAuthHeaders(),
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    this.coverBlobUrlCache.set(key, objectUrl);
    return objectUrl;
  }

  static rememberSessionState(state?: ServerSessionState | null) {
    this.sessionStateCache = state || null;
  }

  static async canUseDirectCoverUrl() {
    if (this.sessionStateCache?.authenticated) {
      return true;
    }
    try {
      const session = await this.getSessionState();
      this.rememberSessionState(session);
      return !!session?.authenticated;
    } catch (error) {
      return false;
    }
  }

  static async getCoverUrl(key: string) {
    const cached = this.coverUrlCache.get(key);
    if (cached) {
      return cached;
    }
    const url = `${this.getBaseUrl()}/api/library/books/${key}/cover?t=${Date.now()}`;
    this.coverUrlCache.set(key, url);
    return url;
  }

  static invalidateCoverUrl(key: string) {
    const cached = this.coverUrlCache.get(key);
    if (cached && cached.startsWith("blob:")) {
      URL.revokeObjectURL(cached);
    }
    this.coverUrlCache.delete(key);
    const cachedBlobUrl = this.coverBlobUrlCache.get(key);
    if (cachedBlobUrl && cachedBlobUrl.startsWith("blob:")) {
      URL.revokeObjectURL(cachedBlobUrl);
    }
    this.coverBlobUrlCache.delete(key);
  }

  static async listRecords(recordType: RecordType) {
    return this.request<any[]>(`/api/library/records/${recordType}`);
  }

  static async listRecordsByBookKey(recordType: RecordType, bookKey: string) {
    return this.request<any[]>(
      `/api/library/records/${recordType}/by-book/${bookKey}`
    );
  }

  static async saveRecord(recordType: RecordType, payload: any) {
    return this.request<any>(`/api/library/records/${recordType}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  static async updateRecord(recordType: RecordType, key: string, payload: any) {
    return this.request<any>(`/api/library/records/${recordType}/${key}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  static async deleteRecord(recordType: RecordType, key: string) {
    return this.request<{ success: boolean }>(
      `/api/library/records/${recordType}/${key}`,
      {
        method: "DELETE",
      }
    );
  }

  static async getSessionState() {
    const state = await this.request<ServerSessionState>("/api/library/session", {
      headers: {},
    });
    this.rememberSessionState(state);
    return state;
  }

  static async login(username: string, password: string) {
    const state = await this.request<ServerSessionState>("/api/library/session", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.rememberSessionState(state);
    return state;
  }

  static async logout() {
    this.rememberSessionState(null);
    return this.request<{ success: boolean }>("/api/library/session", {
      method: "DELETE",
    });
  }

  static async getUsers() {
    return this.request<ServerUserRecord[]>("/api/library/users");
  }

  static async createUser(payload: {
    username: string;
    password: string;
    role?: "admin" | "user";
    enabled?: boolean;
  }) {
    return this.request<ServerUserRecord>("/api/library/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  static async updateUser(
    username: string,
    payload: {
      password?: string;
      role?: "admin" | "user";
      enabled?: boolean;
    }
  ) {
    return this.request<ServerUserRecord>(
      `/api/library/users/${encodeURIComponent(username)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );
  }

  static async deleteUser(username: string) {
    return this.request<{ success: boolean }>(
      `/api/library/users/${encodeURIComponent(username)}`,
      {
        method: "DELETE",
      }
    );
  }

  static async getSettings() {
    return this.request<{ adminUsername: string }>("/api/library/settings");
  }

  static async updateSettings(payload: {
    adminUsername?: string;
    adminPassword?: string;
  }) {
    return this.request<{ success: boolean }>("/api/library/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  static async searchMetadata(name: string, author: string) {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (author) params.set("author", author);
    return this.request<{ code: number; data: ServerMetadataItem[] }>(
      `/api/library/metadata?${params.toString()}`
    );
  }

  static async getMetadataDetail(source: string, key: string) {
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (key) params.set("key", key);
    return this.request<ServerMetadataDetailResponse>(
      `/api/library/metadata?${params.toString()}`
    );
  }

  static async getMetadataByISBN(isbn: string) {
    const params = new URLSearchParams();
    if (isbn) params.set("isbn", isbn);
    return this.request<ServerMetadataDetailResponse>(
      `/api/library/metadata?${params.toString()}`
    );
  }
}

export default ServerLibrary;
