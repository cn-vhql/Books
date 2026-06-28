import { RouteComponentProps } from "react-router-dom";
export interface SettingInfoProps extends RouteComponentProps<any> {
  handleSetting: (isSettingOpen: boolean) => void;
  handleSettingMode: (settingMode: string) => void;
  handleFetchDataSourceList: () => void;
  handleFetchDefaultSyncOption: () => void;
  handleFetchPlugins: () => void;
  t: (title: string) => string;
  settingMode: string;
  isServerMode: boolean;
  plugins: any[];
  dataSourceList: string[];
  defaultSyncOption: string;
}
export interface SettingInfoState {}
