import React from "react";

export const SettingFormList = ({
  children,
}: {
  children: React.ReactNode;
}) => <div className="setting-form-list">{children}</div>;

export const SettingFormRow = ({
  title,
  desc,
  control,
}: {
  title: React.ReactNode;
  desc?: React.ReactNode;
  control?: React.ReactNode;
}) => {
  return (
    <div className="setting-form-row">
      <div className="setting-form-copy">
        <div className="setting-form-title">{title}</div>
        {desc ? <p className="setting-form-help">{desc}</p> : null}
      </div>
      <div className="setting-form-control">{control}</div>
    </div>
  );
};

export const SettingFormSection = ({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) => {
  return (
    <div className="setting-form-section">
      <div className="setting-form-section-title">{title}</div>
      {children}
    </div>
  );
};
