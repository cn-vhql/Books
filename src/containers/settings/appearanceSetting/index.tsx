import { connect } from "react-redux";
import AppearanceSetting from "./component";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import { stateType } from "../../../store";

const mapStateToProps = (state: stateType) => {
  return {
    isServerMode: state.manager.isServerMode,
  };
};
const actionCreator = {};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(AppearanceSetting as any) as any) as any);
