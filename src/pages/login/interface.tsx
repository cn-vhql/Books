import { RouteComponentProps } from "react-router-dom";
export interface LoginProps extends RouteComponentProps<any> {
  handleLoadingDialog: (isShowLoading: boolean) => void;
  handleSetting: (isShow: boolean) => void;
  handleSettingMode: (settingMode: string) => void;
  handleSettingDrive: (settingDrive: string) => void;
  handleFetchAuthed: () => Promise<void> | void;
  handleFetchDataSourceList: () => void;
  handleFetchDefaultSyncOption: () => void;
  handleFetchUserInfo: () => Promise<void>;
  cloudSyncFunc: () => Promise<void>;
  t: (title: string) => string;
  isSettingOpen: boolean;
  isShowLoading: boolean;
  isShowSupport: boolean;
  isServerMode: boolean;
  isAuthed: boolean;
  isAuthResolved: boolean;
}

export interface LoginState {
  currentStep: number;
  loginConfig: any;
  isSendingCode: boolean;
  countdown: number;
  serverRegion: string;
  username?: string;
  password?: string;
}
