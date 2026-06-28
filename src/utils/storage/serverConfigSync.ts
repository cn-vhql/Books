import {
  ConfigService,
} from "../../assets/lib/kookit-extra-browser.min";
import ServerLibrary from "./serverLibrary";

let hasPatched = false;

function syncRecordLocationSet(key: string, value: any) {
  if (!ServerLibrary.isEnabled()) {
    return;
  }
  const payload = {
    bookKey: key,
    key,
    payload: value,
    percentage: value?.percentage || "0",
  };
  void ServerLibrary.updateRecord("record_locations", key, payload).catch(
    (error) => {
      console.error("sync recordLocation failed:", error);
    }
  );
}

function syncRecordLocationDelete(key: string) {
  if (!ServerLibrary.isEnabled()) {
    return;
  }
  void ServerLibrary.deleteRecord("record_locations", key).catch((error) => {
    console.error("delete recordLocation failed:", error);
  });
}

export async function initServerConfigSync() {
  if (hasPatched || !ServerLibrary.isEnabled()) {
    return;
  }
  hasPatched = true;

  try {
    const recordLocations = await ServerLibrary.listRecords("record_locations");
    const map: Record<string, any> = {};
    for (const item of recordLocations) {
      const bookKey = item.bookKey || item.key;
      const payload =
        typeof item.payload === "string" ? JSON.parse(item.payload || "{}") : {};
      map[bookKey] = payload;
    }
    ConfigService.setAllObjectConfig(map, "recordLocation");
  } catch (error) {
    console.error("init recordLocation sync failed:", error);
  }

  const originalSetObjectConfig = ConfigService.setObjectConfig.bind(
    ConfigService
  );
  const originalDeleteObjectConfig = ConfigService.deleteObjectConfig.bind(
    ConfigService
  );

  ConfigService.setObjectConfig = function (
    key: string,
    value: any,
    name: string,
    isSync = true
  ) {
    originalSetObjectConfig(key, value, name, isSync);
    if (name === "recordLocation") {
      syncRecordLocationSet(key, value);
    }
  };

  ConfigService.deleteObjectConfig = function (key: string, name: string) {
    originalDeleteObjectConfig(key, name);
    if (name === "recordLocation") {
      syncRecordLocationDelete(key);
    }
  };
}
