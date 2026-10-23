import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { openSegment, Telemetry, type TelemetryEvent, type TelemetrySink } from '@conduktor/core';

// Set in release builds only: any other build sends nothing.
declare const SEGMENT_WRITE_KEY: string;

// A module rather than a parameter: events come from most parts of the extension, and each only says what happened.
let current = Telemetry.off;

export function track(event: TelemetryEvent): void {
  current.track(event);
}

/** A dry run made on open or save, rather than asked for. */
export function countAutomaticCheck(): void {
  current.countAutomaticCheck();
}

/**
 * Events go through VS Code's telemetry logger, so its telemetry setting decides, policies included: usage events are
 * dropped unless it is "all". The environment can opt out too (CDK_ENABLE_PRODUCT_METRICS=false, DO_NOT_TRACK=1).
 */
export function startTelemetry(context: vscode.ExtensionContext): vscode.Disposable {
  const segment = openSegment(SEGMENT_WRITE_KEY, process.env, homedir());
  if (!segment) return new vscode.Disposable(() => undefined);
  // The logger names events after the extension; Segment gets them as they were tracked.
  const prefix = `${context.extension.id}/`;
  const logger = vscode.env.createTelemetryLogger(
    {
      sendEventData: (name, data) =>
        segment.send(name.startsWith(prefix) ? name.slice(prefix.length) : name, data ?? {}),
      sendErrorData: () => undefined,
      flush: () => segment.flush(),
    },
    { ignoreBuiltInCommonProperties: true },
  );
  const sink: TelemetrySink = {
    send: (event, properties) => logger.logUsage(event, properties),
    flush: () => segment.flush(),
  };
  const telemetry = new Telemetry(sink, {
    surface: 'editor',
    client: 'vscode',
    extensionVersion: (context.extension.packageJSON as { version: string }).version,
  });
  telemetry.identify('vscode', vscode.version);
  current = telemetry;
  return new vscode.Disposable(() => {
    current = Telemetry.off;
    void telemetry.dispose().finally(() => logger.dispose());
  });
}
