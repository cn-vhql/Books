import React from "react";
import "./settingDialog.css";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import GeneralSetting from "../../../containers/settings/generalSetting";
import SyncSetting from "../../../containers/settings/syncSetting";
import AccountSetting from "../../../containers/settings/accountSetting";
import PluginSetting from "../../../containers/settings/pluginSetting";
import ReadingSetting from "../../../containers/settings/readingSetting";
import AppearanceSetting from "../../../containers/settings/appearanceSetting";
import DataSetting from "../../../containers/settings/dataSetting";
import AISetting from "../../../containers/settings/aiSetting";
import BackgroundSetting from "../../../containers/settings/backgroundSetting";
import FontSetting from "../../../containers/settings/fontSetting";
import ChapterSetting from "../../../containers/settings/chapterSetting";
import TextSetting from "../../../containers/settings/textSetting";
import DictSetting from "../../../containers/settings/dictSetting";
import MoreSetting from "../../../containers/settings/moreSetting";
import ShortcutSetting from "../../../containers/settings/shortcutSetting";
import { isElectron } from "react-device-detect";
class SettingDialog extends React.Component<
  SettingInfoProps,
  SettingInfoState
> {
  contentRef = React.createRef<HTMLDivElement>();

  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {};
  }
  componentDidMount(): void {
    if (!this.props.plugins || this.props.plugins.length === 0) {
      this.props.handleFetchPlugins();
    }
    if (
      !this.props.isServerMode &&
      (!this.props.dataSourceList || this.props.dataSourceList.length === 0)
    ) {
      this.props.handleFetchDataSourceList();
    }
    if (
      !this.props.isServerMode &&
      !this.props.defaultSyncOption
    ) {
      this.props.handleFetchDefaultSyncOption();
    }
  }

  componentDidUpdate(prevProps: SettingInfoProps): void {
    if (prevProps.settingMode !== this.props.settingMode) {
      this.contentRef.current?.scrollTo(0, 0);
    }
  }

  renderSidebarItem = (
    mode: string,
    iconClass: string,
    labelKey: string,
    fontSize: string
  ) => {
    const isActive = this.props.settingMode === mode;
    return (
      <div
        className={"setting-dialog-sidebar-item" + (isActive ? " active" : "")}
        onClick={() => {
          this.props.handleSettingMode(mode);
        }}
      >
        <span
          className={"setting-dialog-sidebar-icon " + iconClass}
          style={fontSize ? { fontSize } : {}}
        ></span>
        <Trans>{labelKey}</Trans>
      </div>
    );
  };

  renderSidebarSection = (titleKey: string, children: React.ReactNode) => {
    return (
      <div className="setting-dialog-sidebar-section">
        <div className="setting-dialog-sidebar-section-title">
          <Trans>{titleKey}</Trans>
        </div>
        <div className="setting-dialog-sidebar-group">{children}</div>
      </div>
    );
  };

  getCurrentPageTitle = () => {
    switch (this.props.settingMode) {
      case "general":
        return "通用";
      case "appearance":
        return "外观";
      case "sync":
        return this.props.isServerMode ? "账户" : "同步与备份";
      case "account":
        return "账户";
      default:
        return "设置";
    }
  };

  render() {
    return (
      <div className="setting-dialog-container">
        <div className="setting-dialog-sidebar">
          <div className="setting-dialog-sidebar-header">
            <div className="setting-dialog-sidebar-title">
              设置
            </div>
            <div className="setting-dialog-sidebar-subtitle">
              阅读与书库偏好
            </div>
          </div>

          <div className="setting-dialog-sidebar-scroll">
            {this.renderSidebarSection(
              this.props.isServerMode ? "书库" : "偏好设置",
              <>
                {this.renderSidebarItem("general", "icon-setting", "通用", "")}
                {this.renderSidebarItem(
                  "appearance",
                  "icon-highlight-line",
                  "外观",
                  "20px"
                )}
                {!this.props.isServerMode &&
                  this.renderSidebarItem("data", "icon-archive", "数据", "15px")}
                {!this.props.isServerMode &&
                  this.renderSidebarItem(
                    "reading",
                    "icon-bookshelf-line",
                    "阅读",
                    ""
                  )}
                {!this.props.isServerMode &&
                  this.renderSidebarItem(
                    "shortcut",
                    "icon-keyboard",
                    "快捷键",
                    ""
                  )}
                {!this.props.isServerMode &&
                  this.renderSidebarItem(
                    "sync",
                    "icon-sync",
                    "同步与备份",
                    ""
                  )}
                {this.renderSidebarItem(
                  "account",
                  "icon-user",
                  "账户",
                  "18px"
                )}
                {!this.props.isServerMode &&
                  this.renderSidebarItem(
                    "more",
                    "icon-more",
                    "更多设置",
                    "13px"
                  )}
              </>
            )}

            {!this.props.isServerMode &&
              this.renderSidebarSection(
                "扩展能力",
                <>
                  {this.renderSidebarItem(
                    "plugins",
                    "icon-internet",
                    "插件",
                    ""
                  )}
                  {this.renderSidebarItem(
                    "ai",
                    "icon-idea-line",
                    "AI 服务",
                    "18px"
                  )}
                  {this.renderSidebarItem(
                    "background",
                    "icon-image",
                    "背景",
                    "18px"
                  )}
                  {this.renderSidebarItem(
                    "font",
                    "icon-font",
                    "字体管理",
                    "18px"
                  )}
                  {this.renderSidebarItem(
                    "chapter",
                    "icon-convert-text",
                    "TXT 解析",
                    "19px"
                  )}
                  {this.renderSidebarItem(
                    "text",
                    "icon-edit-line",
                    "文本规则",
                    "18px"
                  )}
                  {isElectron &&
                    this.renderSidebarItem(
                      "dict",
                      "icon-address-book",
                      "本地词典",
                      "18px"
                    )}
                </>
              )}
          </div>
        </div>

        <div className="setting-dialog-main">
          <div className="setting-dialog-main-header">
            <div className="setting-dialog-main-heading">
              <div className="setting-dialog-main-kicker">
                设置
              </div>
              <div className="setting-dialog-main-title">{this.getCurrentPageTitle()}</div>
            </div>
            <div
              className="setting-close-container"
              onClick={() => {
                this.props.handleSetting(false);
                this.props.handleSettingMode("general");
              }}
            >
              <span className="icon-close setting-close"></span>
            </div>
          </div>

          <div className="setting-dialog-main-body">
            <div className="setting-dialog-info" ref={this.contentRef}>
              <div className="setting-dialog-content-surface">
                {this.props.settingMode === "general" ? (
                  <GeneralSetting />
                ) : this.props.settingMode === "reading" ? (
                  <ReadingSetting />
                ) : this.props.settingMode === "shortcut" ? (
                  <ShortcutSetting />
                ) : this.props.settingMode === "appearance" ? (
                  <AppearanceSetting />
                ) : this.props.settingMode === "sync" &&
                  !this.props.isServerMode ? (
                  <SyncSetting />
                ) : this.props.settingMode === "account" ? (
                  <AccountSetting />
                ) : this.props.settingMode === "data" ? (
                  <DataSetting />
                ) : this.props.settingMode === "ai" ? (
                  <AISetting />
                ) : this.props.settingMode === "background" ? (
                  <BackgroundSetting />
                ) : this.props.settingMode === "font" ? (
                  <FontSetting />
                ) : this.props.settingMode === "chapter" ? (
                  <ChapterSetting />
                ) : this.props.settingMode === "text" ? (
                  <TextSetting />
                ) : this.props.settingMode === "dict" ? (
                  <DictSetting />
                ) : this.props.settingMode === "more" ? (
                  <MoreSetting />
                ) : (
                  <PluginSetting />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default SettingDialog;
