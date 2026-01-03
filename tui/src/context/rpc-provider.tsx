import { createContext, useContext, onMount, onCleanup, type ParentComponent } from "solid-js";
import { RpcClient } from "../rpc/client.js";
import { useExit } from "./exit-provider.js";
import type { RpcEvent, RpcRequest } from "../rpc/protocol.js";

type EventHandler = (event: RpcEvent) => void;

interface RpcContextValue {
  send: (request: RpcRequest) => void;
  onEvent: (handler: EventHandler) => () => void;
}

const RpcContext = createContext<RpcContextValue>();

export const RpcProvider: ParentComponent = (props) => {
  const exit = useExit();
  const handlers = new Set<EventHandler>();

  const handleEvent = (event: RpcEvent) => {
    handlers.forEach((h) => {
      try {
        h(event);
      } catch {
        // Ignore handler errors
      }
    });
  };

  const client = new RpcClient(handleEvent);

  onMount(() => {
    void client.start();
    exit.registerCleanup(
      "rpc-close",
      () => {
        client.close();
      },
      5
    );
  });

  onCleanup(() => {
    client.close();
  });

  const send = (request: RpcRequest) => {
    client.send(request);
  };

  const onEvent = (handler: EventHandler): (() => void) => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  };

  return <RpcContext.Provider value={{ send, onEvent }}>{props.children}</RpcContext.Provider>;
};

export function useRpc(): RpcContextValue {
  const ctx = useContext(RpcContext);
  if (!ctx) {
    throw new Error("useRpc must be used within RpcProvider");
  }
  return ctx;
}
