// Original binary GLBs, served as-is (content-hashed filenames, no base64, no re-encoding).
// Vite resolves each `new URL(..., import.meta.url)` to a hashed asset in the build.
export const MODEL_URLS = {
  hypercar: new URL('../../assets/models/hypercar.glb', import.meta.url).href,
  endurance: new URL('../../assets/models/endurance.glb', import.meta.url).href,
  wedge: new URL('../../assets/models/wedge.glb', import.meta.url).href,
  rally: new URL('../../assets/models/rally.glb', import.meta.url).href,
  streamliner: new URL('../../assets/models/streamliner.glb', import.meta.url).href,
  wipeout: new URL('../../assets/models/wipeout.glb', import.meta.url).href
};
