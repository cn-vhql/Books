import { connect } from "react-redux";
import {
  handleDetailDialog,
  handleShelf,
  handleMode,
  handleReadingBook,
} from "../../../store/actions";
import DetailDialog from "./component";
import { stateType } from "../../../store";
import { withRouter } from "react-router-dom";
import { handleFetchBooks } from "../../../store/actions";
import { withTranslation } from "react-i18next";

const mapStateToProps = (state: stateType) => {
  return {
    currentBook: state.book.currentBook,
    currentUser: state.manager.currentUser,
    isServerMode: state.manager.isServerMode,
    notes: state.reader.notes,
  };
};
const actionCreator = {
  handleDetailDialog,
  handleShelf,
  handleMode,
  handleReadingBook,
  handleFetchBooks,
};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(DetailDialog as any) as any) as any);
