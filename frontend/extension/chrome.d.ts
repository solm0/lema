declare namespace chrome {
  namespace action {
    const onClicked: {
      addListener(callback: (tab: tabs.Tab) => void): void;
    };
  }

  namespace runtime {
    type Port = {
      name?: string;
      onDisconnect: {
        addListener(callback: () => void): void;
      };
    };

    function connect(connectInfo?: { name?: string }): Port;
    function sendMessage(message: unknown): Promise<unknown>;

    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  }

  namespace tabs {
    type Tab = {
      id?: number;
      url?: string;
    };

    function create(createProperties: { url: string }): Promise<unknown>;
  }

  namespace scripting {
    function executeScript(injection: {
      target: { tabId: number };
      files: string[];
    }): Promise<unknown>;
  }

}
