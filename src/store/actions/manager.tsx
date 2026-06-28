import {
  ConfigService,
  TokenService,
} from "../../assets/lib/kookit-extra-browser.min";
import BookModel from "../../models/Book";
import PluginModel from "../../models/Plugin";
import { Dispatch } from "redux";
import DatabaseService from "../../utils/storage/databaseService";
import {
  fetchUserInfo,
  getUserRequest,
  resetUserRequest,
} from "../../utils/request/user";
import {
  officialDictList,
  officialTranList,
} from "../../constants/settingList";
import toast from "react-hot-toast";
import BookUtil from "../../utils/file/bookUtil";
import i18n from "../../i18n";
import { azureTTSVoiceList, officialVoiceList } from "../../constants/ttsList";
import { langToName } from "../../utils/common";
import { resetReaderRequest } from "../../utils/request/reader";
import { resetThirdpartyRequest } from "../../utils/request/thirdparty";
import DictUtil from "../../utils/file/dictUtil";
import ServerLibrary from "../../utils/storage/serverLibrary";
export function handleBooks(books: BookModel[]) {
  return { type: "HANDLE_BOOKS", payload: books };
}
export function handleBooksTotal(total: number) {
  return { type: "HANDLE_BOOKS_TOTAL", payload: total };
}
export function handleBooksPage(page: number) {
  return { type: "HANDLE_BOOKS_PAGE", payload: page };
}
export function handleBooksPageSize(pageSize: number) {
  return { type: "HANDLE_BOOKS_PAGE_SIZE", payload: pageSize };
}
export function handlePlugins(plugins: PluginModel[]) {
  return { type: "HANDLE_PLUGINS", payload: plugins };
}
export function handleDeletedBooks(deletedBooks: BookModel[]) {
  return { type: "HANDLE_DELETED_BOOKS", payload: deletedBooks };
}
export function handleSearchResults(searchResults: number[]) {
  return { type: "HANDLE_SEARCH_BOOKS", payload: searchResults };
}
export function handleSearch(isSearch: boolean) {
  return { type: "HANDLE_SEARCH", payload: isSearch };
}
export function handleRefreshBookCover(key: string) {
  return { type: "HANDLE_REFRESH_BOOK_COVER", payload: key };
}
export function handleUserInfo(userInfo: any) {
  return { type: "HANDLE_USER_INFO", payload: userInfo };
}
export function handleDetailDialog(isDetailDialog: boolean) {
  return { type: "HANDLE_DETAIL_DIALOG", payload: isDetailDialog };
}
export function handleSetting(isSettingOpen: boolean) {
  return { type: "HANDLE_SETTING", payload: isSettingOpen };
}
export function handleSettingMode(settingMode: string) {
  return { type: "HANDLE_SETTING_MODE", payload: settingMode };
}
export function handleShowPopupNote(isShowPopupNote: boolean) {
  return { type: "HANDLE_SHOW_POPUP_NOTE", payload: isShowPopupNote };
}
export function handleSettingDrive(settingDrive: string) {
  return { type: "HANDLE_SETTING_DRIVE", payload: settingDrive };
}
export function handleAbout(isAboutOpen: boolean) {
  return { type: "HANDLE_ABOUT", payload: isAboutOpen };
}

export function handleViewMode(mode: string) {
  return { type: "HANDLE_VIEW_MODE", payload: mode };
}

export function handleSortDisplay(isSortDisplay: boolean) {
  return { type: "HANDLE_SORT_DISPLAY", payload: isSortDisplay };
}
export function handleLoadingDialog(isShowLoading: boolean) {
  return { type: "HANDLE_SHOW_LOADING", payload: isShowLoading };
}
export function handleNewDialog(isShowNew: boolean) {
  return { type: "HANDLE_SHOW_NEW", payload: isShowNew };
}
export function handleSelectBook(isSelectBook: boolean) {
  return { type: "HANDLE_SELECT_BOOK", payload: isSelectBook };
}
export function handleSelectedBooks(selectedBooks: string[]) {
  return { type: "HANDLE_SELECTED_BOOKS", payload: selectedBooks };
}
export function handleNewWarning(isNewWarning: boolean) {
  return { type: "HANDLE_NEW_WARNING", payload: isNewWarning };
}
export function handleShowSupport(isShowSupport: boolean) {
  return { type: "HANDLE_SHOW_SUPPORT", payload: isShowSupport };
}
export function handleLoadMore(isLoadMore: boolean) {
  return { type: "HANDLE_LOAD_MORE", payload: isLoadMore };
}
export function handleAuthed(isAuthed: boolean) {
  return { type: "HANDLE_AUTHED", payload: isAuthed };
}
export function handleAuthResolved(isAuthResolved: boolean) {
  return { type: "HANDLE_AUTH_RESOLVED", payload: isAuthResolved };
}
export function handleServerMode(isServerMode: boolean) {
  return { type: "HANDLE_SERVER_MODE", payload: isServerMode };
}
export function handleCurrentUser(currentUser: any) {
  return { type: "HANDLE_CURRENT_USER", payload: currentUser };
}
export function handleBookSortCode(bookSortCode: {
  sort: number;
  order: number;
}) {
  return { type: "HANDLE_SORT_CODE", payload: bookSortCode };
}

export function handleNoteSortCode(noteSortCode: {
  sort: number;
  order: number;
}) {
  return { type: "HANDLE_NOTE_SORT_CODE", payload: noteSortCode };
}

export function handleFetchBooks(page?: number, pageSize?: number) {
  return async (dispatch: Dispatch) => {
    if (ServerLibrary.isEnabled()) {
      try {
        const booksPage = page || 1;
        const booksPerPage = pageSize || 24;
        const response = await ServerLibrary.getBooks(booksPage, booksPerPage);
        dispatch(handleBooks((response.items || []) as BookModel[]));
        dispatch(handleBooksTotal(response.total || 0));
        dispatch(handleBooksPage(response.page || booksPage));
        dispatch(handleBooksPageSize(response.pageSize || booksPerPage));
        dispatch(handleDeletedBooks([]));
      } catch (error) {
        console.error("Failed to fetch server library books:", error);
        dispatch(handleBooks([] as BookModel[]));
        dispatch(handleBooksTotal(0));
        dispatch(handleDeletedBooks([]));
      }
      return;
    }
    let bookSortCodeStr =
      ConfigService.getReaderConfig("bookSortCode") || '{"sort":1,"order":2}';
    let bookSortCode = JSON.parse(bookSortCodeStr);
    let sortField = "key";
    switch (bookSortCode.sort) {
      case 1:
        sortField = "recentRead";
        break;
      case 2:
        sortField = "name";
        break;
      case 3:
        sortField = "key";
        break;
      case 4:
        sortField = "readingTime";
        break;
      case 5:
        sortField = "author";
        break;
      case 6:
        sortField = "percentage";
        break;
      case 7:
        sortField = "size";
        break;
    }
    let orderField = "ASC";
    if (bookSortCode.order === 2) {
      orderField = "DESC";
    }
    let bookList: { key: string }[] = [];
    if (sortField === "recentRead") {
      let allBookKeys = await DatabaseService.getAllRecordKeys("books");
      let recentBookLKeys = ConfigService.getAllListConfig("recentBooks") || [];
      let sortedKeys = [
        ...recentBookLKeys.filter((key) => allBookKeys.includes(key)),
        ...allBookKeys.filter((key) => !recentBookLKeys.includes(key)),
      ];
      if (bookSortCode.order === 1) {
        sortedKeys = sortedKeys.reverse();
      }
      sortedKeys = sortedKeys;
      bookList = sortedKeys.map((key: string) => {
        return { key };
      });
    } else if (sortField === "readingTime") {
      let allBookKeys = await DatabaseService.getAllRecordKeys("books");
      let durationObj = ConfigService.getAllObjectConfig("readingTime");
      var sortable: any[] = [];
      for (let obj in durationObj) {
        sortable.push([obj, durationObj[obj]]);
      }
      sortable.sort(function (a, b) {
        return a[1] - b[1];
      });
      let recentBookLKeys = Object.keys(durationObj) || [];
      let sortedKeys = [
        ...recentBookLKeys.filter((key) => allBookKeys.includes(key)),
        ...allBookKeys.filter((key) => !recentBookLKeys.includes(key)),
      ];
      if (bookSortCode.order === 1) {
        sortedKeys = sortedKeys.reverse();
      }
      sortedKeys = sortedKeys;
      bookList = sortedKeys.map((key: string) => {
        return { key };
      });
    } else if (sortField === "percentage") {
      let allBookKeys = await DatabaseService.getAllRecordKeys("books");
      let locationObj = ConfigService.getAllObjectConfig("recordLocation");
      var sortable: any[] = [];
      for (let obj in locationObj) {
        sortable.push([obj, locationObj[obj].percentage || 0]);
      }
      sortable.sort(function (a, b) {
        return b[1] - a[1];
      });
      let recentBookLKeys = sortable.map((item) => item[0]) || [];
      let sortedKeys = [
        ...recentBookLKeys.filter((key) => allBookKeys.includes(key)),
        ...allBookKeys.filter((key) => !recentBookLKeys.includes(key)),
      ];
      if (bookSortCode.order === 1) {
        sortedKeys = sortedKeys.reverse();
      }
      sortedKeys = sortedKeys;
      bookList = sortedKeys.map((key: string) => {
        return { key };
      });
    } else {
      bookList = await BookUtil.getBookKeysWithSort(sortField, orderField);
    }

    let deletedBookKeys = ConfigService.getAllListConfig("deletedBooks");
    let books = bookList.filter(
      (item: { key: string }) => !deletedBookKeys.includes(item.key)
    );
    dispatch(handleBooks(books as BookModel[]));
    dispatch(
      handleDeletedBooks(deletedBookKeys.map((key) => ({ key })) as BookModel[])
    );
    // DatabaseService.getAllRecords("books").then((value) => {
    //   let bookArr: any = value;
    //   let keyArr = ConfigService.getAllListConfig("deletedBooks");
    //   dispatch(handleDeletedBooks(handleKeyFilter(bookArr, keyArr)));
    //   dispatch(handleBooks(handleKeyRemove(bookArr, keyArr)));
    // });
  };
}
export function handleFetchUserInfo() {
  return async (dispatch: Dispatch) => {
    if (ServerLibrary.isEnabled()) {
      try {
        const session = await ServerLibrary.getSessionState();
        const userInfo = session.user
          ? {
              username: session.user.username,
              role: session.user.role,
              type: session.user.role,
              isAdmin: session.user.role === "admin",
            }
          : null;
        dispatch(handleCurrentUser(session.user || null));
        dispatch(handleUserInfo(userInfo));
        return userInfo;
      } catch (error) {
        dispatch(handleCurrentUser(null));
        dispatch(handleUserInfo(null));
        return null;
      }
    }
    let response = await fetchUserInfo();
    let userInfo: any = null;
    if (response.code === 200) {
      userInfo = response.data;
      ConfigService.setReaderConfig(
        "isEnableKoodoSync",
        userInfo.is_enable_koodo_sync || "no"
      );
      if (
        userInfo.is_enable_koodo_sync === "yes" &&
        userInfo.default_sync_option &&
        userInfo.default_sync_token
      ) {
        if (
          ConfigService.getItem("defaultSyncOption") ===
          userInfo.default_sync_option
        ) {
          let encryptedToken = await TokenService.getToken(
            userInfo.default_sync_option + "_token"
          );
          if (encryptedToken !== userInfo.default_sync_token) {
            await TokenService.setToken(
              userInfo.default_sync_option + "_token",
              userInfo.default_sync_token
            );
          }
        }
      }
    }
    if (
      userInfo &&
      userInfo.valid_until < parseInt(new Date().getTime() / 1000 + "")
    ) {
      dispatch(handleShowSupport(true));
    }
    if (userInfo && userInfo.valid_until && userInfo.token_valid_until) {
      if (
        userInfo.valid_until > 0 &&
        userInfo.token_valid_until > 0 &&
        userInfo.valid_until > userInfo.token_valid_until
      ) {
        let userRequest = await getUserRequest();
        await userRequest.refreshUserToken();
        resetReaderRequest();
        resetUserRequest();
        resetThirdpartyRequest();
      }
    }

    dispatch(handleUserInfo(userInfo));
    return userInfo;
  };
}
export function handleFetchPlugins() {
  return async (dispatch: Dispatch) => {
    DatabaseService.getAllRecords("plugins").then(async (pluginList) => {
      try {
        const isServerMode = ServerLibrary.isEnabled();
        // Migrate legacy AI model entries from DB to ConfigService
        const legacyAiPlugins = pluginList.filter(
          (p: PluginModel) => p.type === "ai"
        );
        for (const p of legacyAiPlugins) {
          const existing = ConfigService.getObjectConfig(
            p.key,
            "aiModelConfig",
            null
          );
          if (!existing) {
            ConfigService.setObjectConfig(
              p.key,
              { key: p.key, displayName: p.displayName, config: p.config },
              "aiModelConfig"
            );
          }
          await DatabaseService.deleteRecord(p.key, "plugins");
        }
        pluginList = pluginList.filter((p: PluginModel) => p.type !== "ai");

        // Load local dictionary plugins from ConfigService
        const localDictIds = DictUtil.getDictIds();
        for (const dictId of localDictIds) {
          const meta = DictUtil.getDictMeta(dictId);
          if (meta) {
            let localDictPlugin = new PluginModel(
              `dict-${dictId}`,
              "dictionary",
              meta.name,
              "dict",
              "1.0.0",
              "",
              { dictId },
              [],
              [],
              "",
              ""
            );
            pluginList.push(localDictPlugin);
          }
        }

        if (ConfigService.getReaderConfig("aiTranslateModel")) {
          const modelKey = ConfigService.getReaderConfig("aiTranslateModel");
          const entry = ConfigService.getObjectConfig(
            modelKey,
            "aiModelConfig",
            null
          );
          if (entry && entry.key) {
            let transPlugin = new PluginModel(
              "custom-ai-trans-plugin",
              "translation",
              "Custom AI Translation",
              "translation",
              "1.0.0",
              "",
              entry.config || {},
              officialTranList,
              [],
              "",
              ""
            );
            pluginList.push(transPlugin);
          }
        }
        if (ConfigService.getReaderConfig("aiDictModel")) {
          const modelKey = ConfigService.getReaderConfig("aiDictModel");
          const entry = ConfigService.getObjectConfig(
            modelKey,
            "aiModelConfig",
            null
          );
          if (entry && entry.key) {
            let dictPlugin = new PluginModel(
              "custom-ai-dict-plugin",
              "dictionary",
              "Custom AI Dictionary",
              "dict",
              "1.0.0",
              "",
              entry.config || {},
              officialDictList,
              [],
              "",
              ""
            );
            pluginList.push(dictPlugin);
          }
        }
        if (ConfigService.getReaderConfig("aiAssistanceModel")) {
          const modelKey = ConfigService.getReaderConfig("aiAssistanceModel");
          const entry = ConfigService.getObjectConfig(
            modelKey,
            "aiModelConfig",
            null
          );
          if (entry && entry.key) {
            let assistPlugin = new PluginModel(
              "custom-ai-assistant-plugin",
              "assistant",
              "Custom AI Assistance",
              "assistant",
              "1.0.0",
              "",
              entry.config || {},
              officialTranList,
              [],
              "",
              ""
            );
            pluginList.push(assistPlugin);
          }
        }
        if (isServerMode) {
          dispatch(handlePlugins(pluginList));
          return;
        }
        TokenService.getToken("is_authed").then((value) => {
          let isAuthed = value === "yes";
          if (
            isAuthed &&
            ConfigService.getReaderConfig("isDisableAI") !== "yes"
          ) {
            let dictPlugin = new PluginModel(
              "official-ai-dict-plugin",
              "dictionary",
              "Official AI Dictionary",
              "dict",
              "1.0.0",
              "",
              {},
              officialDictList,
              [],
              "",
              ""
            );
            pluginList.push(dictPlugin);
            let transPlugin = new PluginModel(
              "official-ai-trans-plugin",
              "translation",
              "Official AI Translation",
              "translation",
              "1.0.0",
              "",
              {},
              officialTranList,
              [],
              "",
              ""
            );
            pluginList.push(transPlugin);
            let sumPlugin = new PluginModel(
              "official-ai-assistant-plugin",
              "assistant",
              "Official AI Assistant",
              "assistant",
              "1.0.0",
              "",
              {},
              officialTranList,
              [],
              "",
              ""
            );
            pluginList.push(sumPlugin);
            let sortedVoiceList = [
              ...officialVoiceList.map((item) => {
                return {
                  ...item,
                  label:
                    i18n.t("Official AI Voice") +
                    " - " +
                    item.displayName +
                    " - " +
                    item.language +
                    " - " +
                    (item.gender === "female"
                      ? i18n.t("Female voice")
                      : i18n.t("Male voice")),
                };
              }),
              ...azureTTSVoiceList.map((item) => {
                return {
                  ...item,
                  label:
                    "Azure TTS" +
                    " - " +
                    item.displayName +
                    " - " +
                    langToName(item.locale) +
                    " - " +
                    (item.gender === "female"
                      ? i18n.t("Female voice")
                      : i18n.t("Male voice")),
                };
              }),
            ];
            let voicePlugin = new PluginModel(
              "official-ai-voice-plugin",
              "voice",
              "Official AI Voice",
              "speaker",
              "1.0.0",
              "",
              {},
              {},
              sortedVoiceList.map((item: any) => {
                return {
                  ...item, // 创建新对象
                  plugin: "official-ai-voice-plugin",
                  config: {},
                  displayName: item.label,
                };
              }),
              "",
              ""
            );
            pluginList.push(voicePlugin);
            dispatch(handlePlugins(pluginList));
          } else if (isAuthed) {
            let sortedVoiceList = [
              ...azureTTSVoiceList.map((item) => {
                return {
                  ...item,
                  label:
                    "Azure TTS" +
                    " - " +
                    item.displayName +
                    " - " +
                    langToName(item.locale) +
                    " - " +
                    (item.gender === "female"
                      ? i18n.t("Female voice")
                      : i18n.t("Male voice")),
                };
              }),
            ];
            let voicePlugin = new PluginModel(
              "official-ai-voice-plugin",
              "voice",
              "Official AI Voice",
              "speaker",
              "1.0.0",
              "",
              {},
              {},
              sortedVoiceList.map((item: any) => {
                return {
                  ...item, // 创建新对象
                  plugin: "official-ai-voice-plugin",
                  config: {},
                  displayName: item.label,
                };
              }),
              "",
              ""
            );
            pluginList.push(voicePlugin);
            dispatch(handlePlugins(pluginList));
          } else {
            dispatch(handlePlugins(pluginList));
          }
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        toast.error(errorMessage);
        console.error(error);
      }
    });
  };
}
export function handleFetchAuthed() {
  return async (dispatch: Dispatch) => {
    try {
      dispatch(handleAuthResolved(false));
      const isServerMode = ServerLibrary.isEnabled();
      dispatch(handleServerMode(isServerMode));
      if (isServerMode) {
        const session = await ServerLibrary.getSessionState();
        const isAuthed = !!session.authenticated;
        dispatch(handleAuthed(isAuthed));
        dispatch(handleCurrentUser(session.user || null));
        if (session.user) {
          dispatch(
            handleUserInfo({
              username: session.user.username,
              role: session.user.role,
              type: session.user.role,
              isAdmin: session.user.role === "admin",
            })
          );
        } else {
          dispatch(handleUserInfo(null));
        }
        dispatch(handleAuthResolved(true));
        return;
      }
      TokenService.getToken("is_authed").then((value) => {
        let isAuthed = value === "yes";
        if (isAuthed && !ConfigService.getItem("serverRegion")) {
          ConfigService.setItem("serverRegion", "global");
        }
        dispatch(handleAuthed(isAuthed));
        dispatch(handleCurrentUser(null));
        dispatch(handleAuthResolved(true));
      });
    } catch (error) {
      console.error(error);
      dispatch(handleAuthed(false));
      dispatch(handleCurrentUser(null));
      dispatch(handleUserInfo(null));
      dispatch(handleAuthResolved(true));
    }
  };
}
export function handleFetchBookSortCode() {
  return (dispatch: Dispatch) => {
    let bookSortCode = JSON.parse(
      ConfigService.getReaderConfig("bookSortCode") || '{"sort": 1, "order": 2}'
    );
    dispatch(handleBookSortCode(bookSortCode));
  };
}
export function handleFetchNoteSortCode() {
  return (dispatch: Dispatch) => {
    let noteSortCode = JSON.parse(
      ConfigService.getReaderConfig("noteSortCode") || '{"sort": 1, "order": 2}'
    );
    dispatch(handleNoteSortCode(noteSortCode));
  };
}
export function handleFetchViewMode() {
  return (dispatch: Dispatch) => {
    let viewMode = ConfigService.getReaderConfig("viewMode") || "card";
    dispatch(handleViewMode(viewMode));
  };
}
