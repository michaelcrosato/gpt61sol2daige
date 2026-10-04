import type { Page } from "@playwright/test";

export async function instrumentRtc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = window as typeof window & {
      rtcDiagnostics: {
        states: string[];
        candidates: string[];
        errors: string[];
        closes: string[];
      }[];
    };
    probe.rtcDiagnostics = [];
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        const log = {
          states: [] as string[],
          candidates: [] as string[],
          errors: [] as string[],
          closes: [] as string[],
        };
        probe.rtcDiagnostics.push(log);
        for (const event of [
          "connectionstatechange",
          "iceconnectionstatechange",
          "signalingstatechange",
        ])
          this.addEventListener(event, () =>
            log.states.push(
              `${this.connectionState}/${this.iceConnectionState}/${this.signalingState}`,
            ),
          );
        this.addEventListener("icecandidate", (e) => {
          if (e.candidate) log.candidates.push(e.candidate.type ?? "unknown");
        });
        this.addEventListener("icecandidateerror", (e) =>
          log.errors.push(`${e.errorCode}: ${e.errorText}`),
        );
        const watch = (channel: RTCDataChannel) => {
          channel.addEventListener("error", (e) =>
            log.errors.push(String((e as RTCErrorEvent).error?.message)),
          );
          const close = channel.close.bind(channel);
          channel.close = () => {
            if (log.closes.length < 3) log.closes.push(new Error("Data channel close").stack ?? "");
            close();
          };
        };
        this.addEventListener("datachannel", (e) => watch(e.channel));
        const create = this.createDataChannel.bind(this);
        this.createDataChannel = (...args: Parameters<RTCPeerConnection["createDataChannel"]>) => {
          const channel = create(...args);
          watch(channel);
          return channel;
        };
      }
    };
  });
}

export async function rtcDiagnostics(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const { role, state, peers, message } = window.fern.network.status();
    return {
      role,
      state,
      peers,
      message,
      rtc: (window as typeof window & { rtcDiagnostics?: unknown }).rtcDiagnostics,
    };
  });
}
