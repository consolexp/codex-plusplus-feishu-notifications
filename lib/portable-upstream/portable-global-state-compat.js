// PORTABLE_PATCH: Stable global-state wrapper for portable settings so
// upstream store API changes are isolated in one place.
import {
describePortableGlobalStateCandidates,
resolvePortableGlobalStateScope,
resolvePortableGlobalStateStoreHook,
writePortableHostGlobalStateValue,
} from "./portable-host-request-compat.js";
import {
sendPortableHostRequest
} from "./portable-host-request-compat.js";

export function usePortableGlobalStateStore() {
const GlobalStateScope = resolvePortableGlobalStateScope();
const useGlobalStateStore = resolvePortableGlobalStateStoreHook();

if (!GlobalStateScope || typeof useGlobalStateStore !== "function") {
throw new Error(
`Portable global state could not resolve AppScope/store hook. candidates=${describePortableGlobalStateCandidates()}`,
);
}

const globalStateStore = useGlobalStateStore(GlobalStateScope);
if (
!globalStateStore ||
typeof globalStateStore !== "object" ||
typeof globalStateStore.get !== "function" ||
typeof globalStateStore.set !== "function" ||
!globalStateStore.query ||
typeof globalStateStore.query.snapshot !== "function"
) {
throw new Error(
`Portable global state resolved an incompatible store shape. keys=${Object.keys(globalStateStore || {}).join(",") || "none"}`,
);
}

return globalStateStore;
}

export function createPortableGlobalStateWriter(globalStateStore) {
return (key, value) =>
writePortableHostGlobalStateValue(globalStateStore, key, value);
}

export async function readPortableGlobalStateValue(key) {
const response = await sendPortableHostRequest("get-global-state", {
params: {
key
},
});
return response?.value;
}

export async function writePortableGlobalStateValue(key, value) {
return sendPortableHostRequest("set-global-state", {
params: {
key,
value
},
});
}
