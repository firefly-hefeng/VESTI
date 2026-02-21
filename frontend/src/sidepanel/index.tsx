import "~style.css";
import { VestiSidepanel } from "./VestiSidepanel";
import { initializeUiTheme } from "~lib/services/uiSettingsService";

void initializeUiTheme().catch(() => {
  // Ignore theme initialization failures and keep default light tokens.
});

export default VestiSidepanel;
