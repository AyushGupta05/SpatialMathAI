import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

function cssLabel(text, style = "annotation") {
  const element = document.createElement("div");
  element.className = `scene-label scene-label--${style}`;
  element.textContent = text;
  return new CSS2DObject(element);
}

function midpoint(from, to) {
  return new THREE.Vector3(
    (from.x + to.x) * 0.5,
    (from.y + to.y) * 0.5,
    (from.z + to.z) * 0.5,
  );
}

function lineMidpointFromObject(objectSpec) {
  const start = Array.isArray(objectSpec?.params?.start) ? new THREE.Vector3(...objectSpec.params.start) : new THREE.Vector3();
  const end = Array.isArray(objectSpec?.params?.end) ? new THREE.Vector3(...objectSpec.params.end) : new THREE.Vector3(1, 0, 0);
  return midpoint(start, end);
}

export class AnalyticOverlayManager {
  constructor(world, sceneApi) {
    this.world = world;
    this.sceneApi = sceneApi;
    this.entries = [];
  }

  clear() {
    for (const entry of this.entries) {
      entry.group.traverse((child) => {
        if (child.geometry?.dispose) child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((material) => material?.dispose?.());
        else child.material?.dispose?.();
        child.element?.remove?.();
      });
      this.world.scene.remove(entry.group);
    }
    this.entries = [];
  }

  render(plan, visibleOverlayIds = []) {
    this.clear();
    if (!plan?.sceneOverlays?.length) return;
    if (Array.isArray(visibleOverlayIds) && visibleOverlayIds.length === 0) return;

    const allowed = new Set(visibleOverlayIds || []);
    for (const overlay of plan.sceneOverlays) {
      if (allowed.size && !allowed.has(overlay.id)) continue;
      const group = this.#createOverlayGroup(overlay);
      if (!group) continue;
      this.world.scene.add(group);
      this.entries.push({ id: overlay.id, group });
    }
  }

  #createOverlayGroup(overlay) {
    switch (overlay.type) {
      case "coordinate-frame":
        return this.#createCoordinateFrame(overlay);
      case "object-label":
        return this.#createObjectLabel(overlay);
      case "point-label":
      case "text":
        return this.#createTextLabel(overlay);
      case "arrow":
        return this.#createArrow(overlay);
      default:
        return null;
    }
  }

  #anchorForObject(objectId, offset = [0, 0, 0]) {
    const objectSpec = this.sceneApi?.getObject?.(objectId);
    if (!objectSpec) return null;
    const base = objectSpec.shape === "line"
      ? lineMidpointFromObject(objectSpec)
      : new THREE.Vector3(...(objectSpec.position || [0, 0, 0]));
    return base.add(new THREE.Vector3(...offset));
  }

  #createObjectLabel(overlay) {
    const anchor = this.#anchorForObject(overlay.targetObjectId, overlay.offset || [0, 0, 0]);
    if (!anchor) return null;
    const group = new THREE.Group();
    const label = cssLabel(overlay.text, overlay.style || "annotation");
    label.position.copy(anchor);
    group.add(label);
    return group;
  }

  #createTextLabel(overlay) {
    if (!Array.isArray(overlay.position)) return null;
    const group = new THREE.Group();
    const label = cssLabel(overlay.text, overlay.style || "annotation");
    label.position.set(overlay.position[0], overlay.position[1], overlay.position[2]);
    group.add(label);
    return group;
  }

  #createArrow(overlay) {
    if (!Array.isArray(overlay.origin) || !Array.isArray(overlay.target)) return null;
    const origin = new THREE.Vector3(...overlay.origin);
    const target = new THREE.Vector3(...overlay.target);
    const delta = target.clone().sub(origin);
    const length = Math.max(0.001, delta.length());
    const direction = delta.normalize();
    const color = new THREE.Color(overlay.color || "#ffd966");
    const group = new THREE.Group();
    const arrow = new THREE.ArrowHelper(direction, origin, length, color, Math.max(0.25, length * 0.16), Math.max(0.16, length * 0.12));
    group.add(arrow);
    if (overlay.text) {
      const label = cssLabel(overlay.text, overlay.style || "annotation");
      const labelPoint = midpoint(origin, target).add(new THREE.Vector3(0, 0.35, 0));
      label.position.copy(labelPoint);
      group.add(label);
    }
    return group;
  }

  #createCoordinateFrame(overlay) {
    const bounds = overlay.bounds || {
      x: [-4, 4],
      y: [-4, 4],
      z: [-4, 4],
      tickStep: 1,
    };
    const tickStep = Math.max(1, Number(bounds.tickStep) || 1);
    const colors = {
      x: new THREE.Color("#ff7c7c"),
      y: new THREE.Color("#7cf7e4"),
      z: new THREE.Color("#48c9ff"),
    };
    const group = new THREE.Group();

    const axes = [
      { key: "x", from: [bounds.x[0], 0, 0], to: [bounds.x[1], 0, 0] },
      { key: "y", from: [0, bounds.y[0], 0], to: [0, bounds.y[1], 0] },
      { key: "z", from: [0, 0, bounds.z[0]], to: [0, 0, bounds.z[1]] },
    ];

    for (const axis of axes) {
      const from = new THREE.Vector3(...axis.from);
      const to = new THREE.Vector3(...axis.to);
      const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      const material = new THREE.LineBasicMaterial({ color: colors[axis.key], transparent: true, opacity: 0.58 });
      const line = new THREE.Line(geometry, material);
      group.add(line);

      const axisLabel = cssLabel(axis.key.toUpperCase(), "annotation");
      axisLabel.position.copy(to.clone().add(new THREE.Vector3(0.15, 0.15, 0.15)));
      group.add(axisLabel);
    }

    for (let x = bounds.x[0]; x <= bounds.x[1]; x += tickStep) {
      if (x === 0) continue;
      const label = cssLabel(String(x), "annotation");
      label.position.set(x, 0.15, 0);
      group.add(label);
    }
    for (let y = bounds.y[0]; y <= bounds.y[1]; y += tickStep) {
      if (y === 0) continue;
      const label = cssLabel(String(y), "annotation");
      label.position.set(0.15, y, 0);
      group.add(label);
    }
    for (let z = bounds.z[0]; z <= bounds.z[1]; z += tickStep) {
      if (z === 0) continue;
      const label = cssLabel(String(z), "annotation");
      label.position.set(0, 0.15, z);
      group.add(label);
    }

    return group;
  }
}
