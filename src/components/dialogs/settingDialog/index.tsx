import { connect } from "react-redux";
import SettingDialog from "./component";
import { withTranslation } from "react-i18next";
import {
  handleSetting,
  handleFetchPlugins,
  handleFetchDataSourceList,
  handleFetchDefaultSyncOption,
  handleSettingMode,
} from "../../../store/actions";
import { stateType } from "../../../store";
import { withRouter } from "react-router-dom";

const mapStateToProps = (state: stateType) => {
  return {
    settingMode: state.manager.settingMode,
    isServerMode: state.manager.isServerMode,
    plugins: state.manager.plugins,
    dataSourceList: state.backupPage.dataSourceList,
    defaultSyncOption: state.backupPage.defaultSyncOption,
  };
};
const actionCreator = {
  handleSetting,
  handleFetchPlugins,
  handleFetchDataSourceList,
  handleFetchDefaultSyncOption,
  handleSettingMode,
};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(SettingDialog as any) as any) as any);
