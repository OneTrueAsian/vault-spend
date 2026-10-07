/** Browser integration entry only; build guard excludes this controller from shipped assets. */
import { createRoot } from "react-dom/client";
import { MobileOfflineApp } from "./MobileOfflineApp";
import { createMobileRepository } from "./mobileIndexedDb";
const repository=createMobileRepository();
Object.assign(window,{mobileStorageProbe:repository});
createRoot(document.getElementById("root")!).render(<MobileOfflineApp repository={repository}/>);
