let exitHandler: (() => void) | null = null;

export function setExitHandler(handler: () => void) {
  exitHandler = handler;
}

export function exitTui() {
  if (exitHandler) {
    exitHandler();
  } else {
    process.exit(0);
  }
}
