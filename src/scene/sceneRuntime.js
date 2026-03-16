import { buildMeshFromSceneObject, disposeSceneMesh, sceneObjectFromMesh } from "./objectMesh.js";
import { createSceneStore } from "./sceneStore.js";
import {
  legacyItemToSceneObject,
  normalizeSceneObject,
  normalizeSceneSnapshot,
  sceneObjectToLegacyItem,
} from "./schema.js";

let firstObjectEmitted = false;

function objectLabelForIndex(index) {
  let value = Math.max(0, index);
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function createSceneRuntime({ world }) {
  const store = createSceneStore();
  const meshes = [];
  const meshById = new Map();
  let nextSerial = 0;
  let nextGeneratedId = 0;

  function ensureMeshIdentity(mesh, objectSpec = {}) {
    if (!mesh.userData.objectSerial) {
      nextSerial += 1;
      mesh.userData.objectSerial = nextSerial;
    } else {
      nextSerial = Math.max(nextSerial, Number(mesh.userData.objectSerial) || 0);
    }
    if (!mesh.userData.label) {
      mesh.userData.label = objectSpec.label || objectLabelForIndex((Number(mesh.userData.objectSerial) || 1) - 1);
    }
    if (!mesh.userData.sceneObjectId) {
      nextGeneratedId += 1;
      mesh.userData.sceneObjectId = objectSpec.id || `scene-object-${nextGeneratedId}`;
    }
    return mesh.userData.sceneObjectId;
  }

  function registerMesh(mesh, objectSpec = {}, reason = "register") {
    const id = ensureMeshIdentity(mesh, objectSpec);
    if (!meshes.includes(mesh)) {
      meshes.push(mesh);
    }
    meshById.set(id, mesh);
    const sceneObject = sceneObjectFromMesh(mesh);
    sceneObject.id = id;
    sceneObject.label = mesh.userData.label || sceneObject.label;
    sceneObject.metadata = {
      ...(objectSpec.metadata || {}),
      ...(sceneObject.metadata || {}),
    };
    store.upsertObject(sceneObject, reason);
    return mesh;
  }

  function addObject(objectSpec, options = {}) {
    const normalized = normalizeSceneObject(objectSpec);
    const mesh = buildMeshFromSceneObject(world, normalized);
    ensureMeshIdentity(mesh, normalized);
    if (normalized.id) {
      mesh.userData.sceneObjectId = normalized.id;
    }
    if (normalized.label) {
      mesh.userData.label = normalized.label;
    }
    world.scene.add(mesh);
    if (!firstObjectEmitted) {
      firstObjectEmitted = true;
      document.dispatchEvent(new CustomEvent("scene:first-object"));
    }
    registerMesh(mesh, normalized, options.reason || "add");
    if (options.select) {
      setSelection(mesh);
    }
    return mesh;
  }

  function addObjects(objectSpecs = [], options = {}) {
    return objectSpecs.map((objectSpec) => addObject(objectSpec, options));
  }

  function removeMesh(mesh, reason = "remove") {
    if (!mesh) return;
    const id = mesh.userData?.sceneObjectId || null;
    const index = meshes.indexOf(mesh);
    if (index >= 0) meshes.splice(index, 1);
    if (id) meshById.delete(id);
    disposeSceneMesh(world, mesh);
    if (id) {
      store.removeObject(id, reason);
    }
  }

  function clear(reason = "clear") {
    while (meshes.length) {
      const mesh = meshes.pop();
      const id = mesh?.userData?.sceneObjectId || null;
      if (id) meshById.delete(id);
      disposeSceneMesh(world, mesh);
    }
    store.replaceObjects([], reason);
    store.setSelection(null);
  }

  function snapshot() {
    return normalizeSceneSnapshot({
      objects: meshes.map((mesh) => {
        const objectSpec = sceneObjectFromMesh(mesh);
        objectSpec.id = mesh.userData.sceneObjectId;
        objectSpec.label = mesh.userData.label;
        return objectSpec;
      }),
      selectedObjectId: store.state.selectedObjectId,
    });
  }

  function exportLegacyScene() {
    return snapshot().objects.map(sceneObjectToLegacyItem);
  }

  function loadSnapshot(sceneSnapshot, reason = "load") {
    const normalized = normalizeSceneSnapshot(sceneSnapshot);
    clear(reason);
    normalized.objects.forEach((objectSpec) => addObject(objectSpec, { reason }));
    if (normalized.selectedObjectId) {
      setSelection(normalized.selectedObjectId);
    }
    return snapshot();
  }

  function loadLegacyScene(items = [], reason = "legacy-load") {
    return loadSnapshot(
      {
        objects: Array.isArray(items) ? items.map(legacyItemToSceneObject) : [],
        selectedObjectId: null,
      },
      reason
    );
  }

  function notifySceneChanged(reason = "touch", mesh = null) {
    if (mesh) {
      registerMesh(mesh, sceneObjectFromMesh(mesh), reason);
      return;
    }
    store.replaceObjects(snapshot().objects, reason);
  }

  function setSelection(target) {
    const id = typeof target === "string"
      ? target
      : (target?.userData?.sceneObjectId || null);
    store.setSelection(id);
  }

  function getMesh(target) {
    if (!target) return null;
    if (typeof target === "string") return meshById.get(target) || null;
    return target;
  }

  return {
    world,
    store,
    meshes,
    addObject,
    addObjects,
    clear,
    removeMesh,
    registerMesh,
    ensureMeshIdentity,
    notifySceneChanged,
    snapshot,
    exportLegacyScene,
    loadSnapshot,
    loadLegacyScene,
    setSelection,
    getMesh,
    getObject(target) {
      const mesh = getMesh(target);
      return mesh ? sceneObjectFromMesh(mesh) : null;
    },
    getSelection() {
      return store.state.selectedObjectId;
    },
    on(eventName, handler) {
      return store.on(eventName, handler);
    },
  };
}
