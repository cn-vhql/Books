import { isElectron } from "react-device-detect";
import BookModel from "../../models/Book";
import { getStorageLocation } from "../common";
import { Buffer } from "buffer";
import localforage from "localforage";
import SyncService from "../storage/syncService";
import DatabaseService from "../storage/databaseService";
import Book from "../../models/Book";
import {
  CommonTool,
  ConfigService,
  TokenService,
} from "../../assets/lib/kookit-extra-browser.min";
import { getCloudConfig } from "./common";
import { LocalFileManager } from "./localFile";
import ServerLibrary from "../storage/serverLibrary";
declare var window: any;
class AsyncQueue {
  private queue: (() => Promise<void>)[] = [];
  private running = false;

  async add(task: () => Promise<void>) {
    this.queue.push(task);
    if (!this.running) {
      this.running = true;
      await this.run();
    }
  }

  private async run() {
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        try {
          await task();
        } catch (e) {
          console.error("AsyncQueue task error:", e);
        }
      }
    }
    this.running = false;
  }
}

const saveCoverQueue = new AsyncQueue();
class LimitedAsyncQueue {
  private queue: (() => void)[] = [];
  private running = 0;

  constructor(private readonly limit: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.running += 1;
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        } finally {
          this.running -= 1;
          this.next();
        }
      };
      this.queue.push(execute);
      this.next();
    });
  }

  private next() {
    while (this.running < this.limit && this.queue.length > 0) {
      const execute = this.queue.shift();
      execute && execute();
    }
  }
}

const serverCoverFetchQueue = new LimitedAsyncQueue(4);
const serverCoverStore = localforage.createInstance({
  name: "books-server-cache",
  storeName: "covers",
});
class CoverUtil {
  static async getServerCachedCover(book: BookModel) {
    const cacheKey = this.getServerCoverCacheKey(book);
    return (await serverCoverStore.getItem<string>(cacheKey)) || "";
  }
  static async setServerCachedCover(book: BookModel, dataUrl: string) {
    if (!dataUrl) {
      return;
    }
    const cacheKey = this.getServerCoverCacheKey(book);
    await serverCoverStore.setItem(cacheKey, dataUrl);
  }
  static async clearServerCachedCover(key: string) {
    const prefix = `server-cover:${key}:`;
    const keys = await serverCoverStore.keys();
    await Promise.all(
      keys
        .filter((item) => item.startsWith(prefix))
        .map((item) => serverCoverStore.removeItem(item))
    );
  }
  static getServerCoverCacheKey(book: BookModel) {
    return `server-cover:${book.key}:${book.cover || "none"}`;
  }
  static async getCover(book: BookModel) {
    if (!isElectron && ServerLibrary.isEnabled()) {
      if (book.cover && book.cover.startsWith("data:")) {
        return book.cover;
      }
      try {
        const cachedCover = await this.getServerCachedCover(book);
        if (cachedCover) {
          return cachedCover;
        }
        const blobUrl = await serverCoverFetchQueue.run(() =>
          ServerLibrary.fetchCoverBlobUrl(book.key)
        );
        const response = await fetch(blobUrl);
        if (response.ok) {
          const dataUrl = await this.blobToBase64(await response.blob());
          await this.setServerCachedCover(book, dataUrl);
          return dataUrl;
        }
        return blobUrl;
      } catch (error) {
        console.warn("Failed to fetch server cover", book.key, error);
        return "";
      }
    }
    if (isElectron) {
      var fs = window.require("fs");
      var path = window.require("path");
      let directoryPath = path.join(getStorageLocation() || "", "cover");
      if (!fs.existsSync(directoryPath)) {
        return book.cover;
      }
      const files = fs.readdirSync(directoryPath);
      const imageFiles = files.filter((file) => file.startsWith(book.key));
      if (imageFiles.length === 0) {
        return book.cover;
      }
      const imageFilePath = path.join(directoryPath, imageFiles[0]);
      if (!fs.existsSync(imageFilePath)) {
        return book.cover;
      }
      return imageFilePath;
    } else {
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        let coverList = await this.getLocalCoverList();
        if (!coverList || coverList.length === 0) {
          return book.cover;
        }
        let cover = coverList.find((item) => item.startsWith(book.key));
        if (!cover) {
          return book.cover;
        }
        let coverBuffer = await LocalFileManager.readFile(cover, "cover");
        if (!coverBuffer) {
          return book.cover;
        }
        const extension = cover.split(".").reverse()[0];
        const blob = new Blob([coverBuffer], { type: `image/${extension}` });
        const objectUrl = URL.createObjectURL(blob);
        return objectUrl;
      } else {
        return book.cover;
      }
    }
  }
  static async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = (error) => {
        reject(error);
      };
      reader.readAsDataURL(blob);
    });
  }
  static async isCoverExist(book: BookModel) {
    if (!isElectron && ServerLibrary.isEnabled()) {
      return !!book?.cover;
    }
    if (!book) return false;
    if (book.cover) {
      return true;
    }
    if (isElectron) {
      var fs = window.require("fs");
      var path = window.require("path");
      let directoryPath = path.join(getStorageLocation() || "", "cover");
      if (!fs.existsSync(directoryPath)) {
        return false;
      }
      const files = fs.readdirSync(directoryPath);
      const imageFiles = files.filter((file) => file.startsWith(book.key));
      return imageFiles.length > 0;
    } else {
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        let coverList = await this.getLocalCoverList();
        if (!coverList || coverList.length === 0) {
          return book.cover !== "";
        }
        let cover = coverList.find((item) => item.startsWith(book.key));
        if (!cover) {
          return book.cover !== "";
        }
        return true;
      } else {
        return book.cover !== "";
      }
    }
  }
  static async deleteCover(key: string) {
    if (!isElectron && ServerLibrary.isEnabled()) {
      await this.clearServerCachedCover(key);
      return;
    }
    if (isElectron) {
      var fs = window.require("fs");
      var path = window.require("path");
      let directoryPath = path.join(getStorageLocation() || "", "cover");
      if (!fs.existsSync(directoryPath)) {
        return;
      }
      const files = fs.readdirSync(directoryPath);
      const imageFiles = files.filter((file) => file.startsWith(key));
      if (imageFiles.length === 0) {
        return;
      }
      const imageFilePath = path.join(directoryPath, imageFiles[0]);
      if (fs.existsSync(imageFilePath)) {
        fs.unlinkSync(imageFilePath);
      }
    } else {
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        let coverList = await this.getLocalCoverList();
        if (!coverList || coverList.length === 0) {
          return;
        }
        let cover = coverList.find((item) => item.startsWith(key));
        if (!cover) {
          return;
        }
        await LocalFileManager.deleteFile(cover, "cover");
      }
    }
    this.deleteCloudCover(key);
  }
  static async deleteOfflineCover(key: string) {
    if (!isElectron && ServerLibrary.isEnabled()) {
      await this.clearServerCachedCover(key);
      return;
    }
    try {
      if (isElectron) {
        var fs = window.require("fs");
        var path = window.require("path");
        let directoryPath = path.join(getStorageLocation() || "", "cover");
        if (!fs.existsSync(directoryPath)) {
          return;
        }
        const files = fs.readdirSync(directoryPath);
        const imageFiles = files.filter((file) => file.startsWith(key));
        if (imageFiles.length === 0) {
          return;
        }
        const imageFilePath = path.join(directoryPath, imageFiles[0]);
        if (fs.existsSync(imageFilePath)) {
          fs.unlinkSync(imageFilePath);
        }
      } else {
        if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
          let coverList = await this.getLocalCoverList();
          if (!coverList || coverList.length === 0) {
            return;
          }
          let cover = coverList.find((item) => item.startsWith(key));
          if (!cover) {
            return;
          }
          await LocalFileManager.deleteFile(cover, "cover");
        }
      }
    } catch (error) {
      console.error("deleteOfflineCover error:", error);
      return;
    }
  }
  static async addCover(book: BookModel) {
    if (!isElectron && ServerLibrary.isEnabled()) {
      return;
    }
    let coverBase64 = book.cover;
    if (!coverBase64) return;
    let base64Data = coverBase64.split("base64,")[1];
    if (!base64Data) return;
    if (isElectron) {
      var fs = window.require("fs");
      var path = window.require("path");
      let directoryPath = path.join(getStorageLocation() || "", "cover");
      if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
      }
      let files = fs.readdirSync(directoryPath);
      let existingCover = files.find((file) => file.startsWith(book.key));
      if (existingCover) {
        fs.unlinkSync(path.join(directoryPath, existingCover));
      }
      const result = await this.convertCoverBase64(book.cover);
      fs.writeFileSync(
        path.join(directoryPath, `${book.key}.${result.extension}`),
        Buffer.from(result.arrayBuffer)
      );
      await this.uploadCover(
        book.key + "." + this.base64ToFileType(book.cover)
      );
      book.cover = "";
    } else {
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        let result = await this.convertCoverBase64(coverBase64);
        await LocalFileManager.saveFile(
          `${book.key}.${result.extension}`,
          result.arrayBuffer,
          "cover"
        );
      }
      await this.uploadCover(
        book.key + "." + this.base64ToFileType(coverBase64)
      );
      // book.cover = "";
    }
  }
  static async convertCoverBase64(base64: string) {
    if (base64.startsWith("blob") || base64.startsWith("http")) {
      let response = await fetch(base64);
      let blob = await response.blob();
      base64 = await CoverUtil.blobToBase64(blob);
    }
    let extension = this.base64ToFileType(base64);

    const base64Data = base64.replace(/^data:.*;base64,/, "");

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const arrayBuffer = bytes.buffer;
    if (extension === "jpg") {
      extension = "jpeg";
    }

    return {
      arrayBuffer,
      extension,
    };
  }
  static base64ToFileType(base64: string) {
    let mimeMatch = base64.match(/^data:(image\/\w+);base64,/);
    if (!mimeMatch) {
      // Decode base64 string to binary string
      base64 = base64.replace(/^data:.*;base64,/, "");
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);

      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Determine file type based on magic numbers
      const header = bytes.subarray(0, 4);
      let fileType = "unknown";
      const signatures: { [key: string]: string } = {
        "89504e47": "png",
        ffd8ffe0: "jpeg",
        ffd8ffe1: "jpeg",
        ffd8ffdb: "jpeg",
        ffd8ffe2: "jpeg",
        "47494638": "gif",
        "424d": "bmp",
        "49492a00": "tiff",
        "4d4d002a": "tiff",
        "52494646": "webp", // 'RIFF' followed by 'WEBP'
        "377abcaf271c": "webp", // WebP extended signature
        "3c3f786d6c": "svg",
        "00000100": "ico",
      };

      const headerHex = Array.from(header)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (signatures[headerHex]) {
        fileType = signatures[headerHex];
      }

      if (!fileType) {
        throw new Error("Invalid base64 string");
      }
      mimeMatch = ["", `image/${fileType}`];
    }
    const mime = mimeMatch[1];

    let extension = mime.split("/")[1];

    return extension;
  }
  static async downloadCover(cover: string) {
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      let service = ConfigService.getItem("defaultSyncOption");
      if (!service) {
        return;
      }
      let tokenConfig = await getCloudConfig(service);

      let result = await ipcRenderer.invoke("cloud-download", {
        ...tokenConfig,
        fileName: cover,
        service: service,
        type: "cover",
        storagePath: getStorageLocation(),
      });
      if (!result) {
        console.error("download cover failed");
        return;
      }
    } else {
      let syncUtil = await SyncService.getSyncUtil();

      let imgBuffer: ArrayBuffer = await syncUtil.downloadFile(cover, "cover");
      if (!imgBuffer) {
        console.error("download cover failed");
        return;
      }
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        await LocalFileManager.saveFile(cover, imgBuffer, "cover");
      } else {
        let imgStr = CommonTool.arrayBufferToBase64(imgBuffer);
        if (!imgStr) {
          console.error("download cover failed");
          return;
        }
        let base64 = `data:image/${
          cover.split(".").reverse()[0]
        };base64,${imgStr}`;
        await this.saveCover(cover, base64);
      }
    }
  }
  static async uploadCover(cover: string) {
    let isAuthed = await TokenService.getToken("is_authed");
    if (isAuthed !== "yes") {
      return;
    }
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      let service = ConfigService.getItem("defaultSyncOption");
      if (!service) {
        return;
      }
      let tokenConfig = await getCloudConfig(service);

      await ipcRenderer.invoke("cloud-upload", {
        ...tokenConfig,
        fileName: cover,
        service: service,
        type: "cover",
        storagePath: getStorageLocation(),
      });
    } else {
      let syncUtil = await SyncService.getSyncUtil();
      let book = await DatabaseService.getRecord(cover.split(".")[0], "books");
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        let coverBuffer = await LocalFileManager.readFile(cover, "cover");
        if (!coverBuffer) {
          return;
        }
        await syncUtil.uploadFile(cover, "cover", coverBuffer);
      } else {
        if (book && book.cover) {
          let base64 = book.cover;
          let result = await this.convertCoverBase64(base64);
          let coverBlob = new Blob([result.arrayBuffer], {
            type: `image/${result.extension}`,
          });
          await syncUtil.uploadFile(cover, "cover", coverBlob);
        }
      }
    }
  }
  static async saveCover(cover: string, base64: string) {
    await saveCoverQueue.add(async () => {
      let book: Book = await DatabaseService.getRecord(
        cover.split(".")[0],
        "books"
      );
      if (book) {
        book.cover = base64;
        await DatabaseService.updateRecord(book, "books");
      }
    });
  }
  static async getLocalCoverList() {
    if (isElectron) {
      var fs = window.require("fs");
      var path = window.require("path");
      let directoryPath = path.join(getStorageLocation() || "", "cover");
      if (!fs.existsSync(directoryPath)) {
        return [];
      }
      const files = fs.readdirSync(directoryPath);
      return files;
    } else {
      if (ConfigService.getReaderConfig("isUseLocal") === "yes") {
        let coverList = await LocalFileManager.listFiles("cover");
        return coverList;
      } else {
        let books: Book[] | null = await DatabaseService.getAllRecords("books");
        return books
          ?.map((book) => {
            if (!book.cover) {
              return "";
            }
            return book.key + "." + this.base64ToFileType(book.cover);
          })
          .filter((item) => item !== "");
      }
    }
  }
  static async getCloudCoverList() {
    if (isElectron) {
      // for ftp, sftp etc
      const { ipcRenderer } = window.require("electron");
      let service = ConfigService.getItem("defaultSyncOption");
      if (!service) {
        return [];
      }
      let tokenConfig = await getCloudConfig(service);

      let cloudCoverList = await ipcRenderer.invoke("cloud-list", {
        ...tokenConfig,
        service: service,
        type: "cover",
        storagePath: getStorageLocation(),
      });
      return cloudCoverList;
    } else {
      let syncUtil = await SyncService.getSyncUtil();
      let cloudCoverList = await syncUtil.listFiles("cover");
      return cloudCoverList;
    }
  }
  static async deleteCloudCover(key: string) {
    let isAuthed = await TokenService.getToken("is_authed");
    if (isAuthed !== "yes") {
      return;
    }
    let coverList = await this.getCloudCoverList();
    for (let cover of coverList) {
      if (cover.startsWith(key)) {
        if (isElectron) {
          const { ipcRenderer } = window.require("electron");
          let service = ConfigService.getItem("defaultSyncOption");
          if (!service) {
            return;
          }
          let tokenConfig = await getCloudConfig(service);

          await ipcRenderer.invoke("cloud-delete", {
            ...tokenConfig,
            fileName: cover,
            service: service,
            type: "cover",
            storagePath: getStorageLocation(),
          });
        } else {
          let syncUtil = await SyncService.getSyncUtil();
          await syncUtil.deleteFile(cover, "cover");
        }
      }
    }
  }
}

export default CoverUtil;
