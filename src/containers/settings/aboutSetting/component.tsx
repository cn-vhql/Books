import React from "react";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import packageJson from "../../../../package.json";
import { isElectron } from "react-device-detect";
import { checkDeveloperUpdate } from "../../../utils/request/common";
declare var window: any;

class AboutSetting extends React.Component<SettingInfoProps, SettingInfoState> {
  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {};
  }

  render() {
    return (
      <>
        <div className="setting-dialog-new-title">
          <Trans>Current version</Trans>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span>{packageJson.version}</span>

            {isElectron && !(process as any).windowsStore && (
              <span
                className="change-location-button"
                style={{ marginLeft: "10px", cursor: "pointer" }}
                onClick={async () => {
                  toast.loading(this.props.t("Checking for update") + "...", {
                    id: "checking_update",
                  });
                  let res = await checkDeveloperUpdate();
                  const newVersion = res.version;
                  if (newVersion === packageJson.version) {
                    toast.success(
                      this.props.t("You are using the latest version"),
                      {
                        id: "checking_update",
                      }
                    );
                  } else {
                    toast.success(
                      this.props.t("A new version is available") +
                        ": " +
                        newVersion,
                      {
                        id: "checking_update",
                      }
                    );
                    toast(
                      this.props.t(
                        "This deployment removes the original external update link. Please update through your current deployment channel."
                      ),
                      {
                        duration: 5000,
                      }
                    );
                  }
                }}
              >
                <Trans>Check for update</Trans>
              </span>
            )}
          </div>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Select update channel</Trans>
          <select
            name=""
            className="lang-setting-dropdown"
            value={ConfigService.getReaderConfig("updateChannel")}
            onChange={(event) => {
              ConfigService.setReaderConfig(
                "updateChannel",
                event.target.value
              );
              toast.success(this.props.t("Change successful"));
              this.forceUpdate();
            }}
          >
            {[
              { value: "dev", label: "Developer version" },
              { value: "stable", label: "Stable version" },
            ].map((item) => (
              <option
                value={item.value}
                key={item.value}
                className="lang-setting-option"
              >
                {this.props.t(item.label)}
              </option>
            ))}
          </select>
        </div>
        {isElectron && (
          <div className="setting-dialog-new-title">
            <Trans>Get debug logs</Trans>
            <span
              className="change-location-button"
              onClick={async () => {
                const { ipcRenderer } = window.require("electron");
                ipcRenderer.invoke("get-debug-logs", "ping");
              }}
            >
              <Trans>Locate</Trans>
            </span>
          </div>
        )}

        {isElectron && (
          <div className="setting-dialog-new-title">
            <Trans>Open console</Trans>
            <span
              className="change-location-button"
              onClick={async () => {
                window
                  .require("electron")
                  .ipcRenderer.invoke("open-console", "ping");
              }}
            >
              <Trans>View</Trans>
            </span>
          </div>
        )}
        <div className="setting-dialog-new-title">
          <span>Books</span>
          <span style={{ opacity: 0.68 }}>
            <Trans>Customized deployment</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Service mode</Trans>
          <span style={{ opacity: 0.68 }}>
            <Trans>External project links removed</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Brand</Trans>
          <span style={{ opacity: 0.68 }}>Books</span>
        </div>
      </>
    );
  }
}

export default AboutSetting;
