import { createRoot } from "react-dom/client";
import { MobileViewer } from "./MobileViewer";
import { mobilePreviewSnapshots } from "./mobilePreviewFixtures";
createRoot(document.getElementById("root")!).render(<><div className="mobile-preview-warning">Synthetic UI preview. No live data, pairing, sync, or encrypted offline storage.</div><MobileViewer snapshots={mobilePreviewSnapshots}/></>);
