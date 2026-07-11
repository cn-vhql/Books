class Book {
  key: string;
  name: string;
  author: string;
  description: string;
  md5: string;
  cover: string;
  format: string;
  publisher: string;
  size: number;
  page: number;
  path: string;
  charset: string;
  isbn?: string;
  doubanId?: string;
  tags?: string;
  publishedAt?: string;
  rating?: string;
  source?: string;
  sourceUrl?: string;
  series?: string;
  owner?: string;
  visibleToAll?: boolean;
  constructor(
    key: string,
    name: string,
    author: string,
    description: string,
    md5: string,
    cover: string,
    format: string,
    publisher: string,
    size: number,
    page: number,
    path: string,
    charset: string
  ) {
    this.key = key;
    this.name = name;
    this.author = author;
    this.description = description;
    this.md5 = md5;
    this.cover = cover;
    this.format = format;
    this.publisher = publisher;
    this.size = size;
    this.page = page;
    this.path = path;
    this.charset = charset;
    this.isbn = "";
    this.doubanId = "";
    this.tags = "";
    this.publishedAt = "";
    this.rating = "";
    this.source = "";
    this.sourceUrl = "";
    this.series = "";
    this.owner = "";
    this.visibleToAll = true;
  }
}

export default Book;
