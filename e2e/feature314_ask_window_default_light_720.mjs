// Shard of the Task 7 compiled Ask window (engine: lib/askWindow.mjs): Default, light theme, 720 px wide. One combination per spec so each fits the suite's 60-second ceiling.
process.env.VS_ASK_STYLE = "Default"; process.env.VS_ASK_THEME = "light"; process.env.VS_ASK_WIDTH = "720";
const { runAskWindow } = await import("./lib/askWindow.mjs");
await runAskWindow({ style: process.env.VS_ASK_STYLE, theme: process.env.VS_ASK_THEME, width: process.env.VS_ASK_WIDTH });
