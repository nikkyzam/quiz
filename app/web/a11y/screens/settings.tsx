/* Settings, onboarding and help rendered in their loaded state for the
   accessibility audit. Effects never run here, so Settings gets its
   preferences through `initial`. */
import { renderToStaticMarkup } from "react-dom/server";
import { Settings } from "../../src/screens/Settings";
import { Onboarding } from "../../src/screens/Onboarding";
import { Help } from "../../src/screens/Help";

const noop = () => {};
const user = { id: "u1", email: "sam@example.com", name: "Sam" };
const learner = { id: "l1", name: "Josiah", beast: "vex", stars: 2, topics: 1 };
const initial = {
  preferences: { emailAlerts: true, emailSummary: true, push: false, locale: "en" },
  channels: { email: false, push: true, inApp: true }
};

const wrap = (node: React.ReactElement) =>
  renderToStaticMarkup(<div className="wrap"><main id="main">{node}</main></div>);

export const SCREENS: Record<string, string> = {
  settings: wrap(<Settings user={user} learner={learner} onBack={noop} onSignOut={noop} initial={initial} />),
  onboarding: wrap(<Onboarding onDone={noop} />),
  help: wrap(<Help onBack={noop} />)
};
