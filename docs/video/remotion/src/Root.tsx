import React from "react";
import { Composition } from "remotion";
import { DURATION, Demo, FPS } from "./Demo";

export const RemotionRoot: React.FC = () => (
  <>
    {/* A: AI narration (offline Windows voice) + short captions */}
    <Composition id="DemoNarrated" component={Demo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ narration: true }} />
    {/* B: no narration; the narration becomes captions, over the game's music */}
    <Composition id="DemoCaptioned" component={Demo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ narration: false }} />
  </>
);
