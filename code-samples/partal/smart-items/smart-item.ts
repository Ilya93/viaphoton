import {
  AbstractMesh,
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Tools,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { PartalGizmoManager } from "@engine/hooks/engine";
import { SceneService } from "@engine/services/scene.service";
import { getSmartItemStateById } from "@proxy/smart-items.store";
import {
  SmartItemAudio,
  SmartItemScale,
  SmartItemTransform,
  SmartItemVM,
  Vec3,
  VideoSettings,
} from "@redux/smart-items/smart-items.models";
import { DebouncedFunc, debounce } from "lodash";
import { snapshot } from "valtio";
import { CollisionBox } from "./components/collision-box";
import { SmartItemGizmo } from "./components/gizmo";
import { SmartItemPivot } from "./components/pivot";
import { SmartItemSound } from "./components/sound";

export type DeepReadOnly<T> = {
  readonly [key in keyof T]: DeepReadOnly<T[key]>;
};

export interface SmartItemBaseInterface {
  entityID: string;
  scene: Scene;
  transformMesh: TransformNode;
  attachedMeshes: (Mesh | AbstractMesh)[];
  readonly rootAttachedMesh: Mesh | AbstractMesh | undefined;
  pivot: SmartItemPivot;
  sound: SmartItemSound;
  gizmo: SmartItemGizmo;
  collisionBox: CollisionBox;
  smartItemEntity: DeepReadOnly<SmartItemVM>;

  setAttachedMeshes(
    attachedMeshes: (Mesh | AbstractMesh)[] | Mesh | AbstractMesh
  ): void;
  setAttachedMeshes(
    attachedMeshes: (Mesh | AbstractMesh)[] | Mesh | AbstractMesh
  ): void;
  updateCommonProps(updatedEntity: SmartItemVM): void;
  updateMeshesMetadata(updatedEntity: SmartItemVM): void;
  updateTransform(transform: SmartItemTransform): void;
  setScale(scale: SmartItemScale): void;
  setPosition(position: Vec3): void;
  setRotation(rotation: Vec3): void;
  setEnabled(enabled: boolean): void;
  disable(): void;
  dispose(): void;
  showDistanceHelper(position: Vec3, distance: number): void;
}

export interface SmartItemInterface extends SmartItemBaseInterface {
  buildItem(): void;
  runItemUpdate(smartItemMetadata?: SmartItemVM): void;
}

export class SmartItem implements SmartItemBaseInterface {
  entityID: string;
  scene: Scene;
  transformMesh: TransformNode;
  attachedMeshes: (Mesh | AbstractMesh)[] = [];
  rootAttachedMesh: Mesh | AbstractMesh;
  pivot: SmartItemPivot;
  sound: SmartItemSound;
  gizmo: SmartItemGizmo;
  collisionBox: CollisionBox;
  smartItemEntity: DeepReadOnly<SmartItemVM>;

  constructor(
    entityID: string,
    scene: Scene,
    gizmoManager?: PartalGizmoManager
  ) {
    this.entityID = entityID;
    this.scene = scene;

    // get item state from proxy store
    const itemStore = getSmartItemStateById(entityID);

    // attach entity metadata
    this.smartItemEntity = snapshot(itemStore.item);

    // create root transform node
    this.transformMesh = new TransformNode(
      `${this.smartItemEntity.data.title}`,
      scene
    );

    // init gizmo
    this.gizmo = new SmartItemGizmo(this, gizmoManager);

    // set visibility settings
    this.setEnabled(this.smartItemEntity.data.isVisible);

    // init collision box
    this.collisionBox = new CollisionBox(this);

    // init pivot point
    this.pivot = new SmartItemPivot(this);

    // init sound
    this.sound = new SmartItemSound(this);
  }

  // call it to update attached meshes
  setAttachedMeshes(
    attachedMeshes: (Mesh | AbstractMesh)[] | Mesh | AbstractMesh
  ) {
    //  attach mesh
    if (Array.isArray(attachedMeshes)) {
      if (!attachedMeshes.length) return;

      this.attachedMeshes = attachedMeshes;
    } else {
      if (!attachedMeshes) return;

      this.attachedMeshes = [attachedMeshes];
    }

    // attach root mesh
    if (this.rootAttachedMesh) this.rootAttachedMesh.dispose();
    this.rootAttachedMesh = this.attachedMeshes[0];
    this.rootAttachedMesh.parent = this.transformMesh;

    // add mesh shadow
    SceneService.shadowGenerator.addShadowCaster(
      this.rootAttachedMesh as AbstractMesh
    );

    this.attachedMeshes.forEach((mesh: Mesh | AbstractMesh) => {
      // set inspector id
      mesh.id = this.smartItemEntity.id;

      // add smart item metadata
      mesh.metadata = { ...this.smartItemEntity, excludeFromSpaceLights: true };

      // ios warnings
      mesh.material?.getActiveTextures().map((x) => {
        const sizes = x.getSize();
        if (sizes.width >= 2048 || sizes.height >= 2048) {
          console.warn(`detected large texture (potential ios issues)`, {
            name: x.name,
            assetName: this.smartItemEntity.data.title,
            sizes,
          });
        } else if (sizes.width >= 4096 || sizes.height >= 4096) {
          console.error(`detected large texture (ios error)`, {
            name: x.name,
            assetName: this.smartItemEntity.data.title,
            sizes,
          });
        }
      });

      // collisions and picking
      if (mesh instanceof AbstractMesh) {
        mesh.isPickable = this.smartItemEntity.data.isPickable;
        mesh.checkCollisions = this.smartItemEntity.data.checkCollisions;
      }

      // parent fallback
      if (!mesh.parent) {
        mesh.parent = this.transformMesh;
      }
    });

    // exclude all attachedMeshes from scene lights
    const lightSources = this.scene.getMeshByName("space")?.lightSources;
    if (lightSources?.length) {
      const excludedMeshes = this.attachedMeshes.filter(
        (x) => x instanceof AbstractMesh
      ) as Mesh[];

      lightSources.forEach((light) => {
        light.excludedMeshes = excludedMeshes;
      });
    }

    // update pivot point
    this.pivot.updatePivotPoint({
      x: -this.smartItemEntity.data.transform.pivotPosition.x,
      y: -this.smartItemEntity.data.transform.pivotPosition.y,
      z: -this.smartItemEntity.data.transform.pivotPosition.z,
    });

    // update transform
    this.updateTransform(this.smartItemEntity.data.transform, true);

    // invert rotation for collision box
    this.collisionBox.updateCollisionBoxRotation();
  }

  async updateCommonProps(updatedEntity: SmartItemVM) {
    // toggle visibility
    if (updatedEntity.data.isVisible !== this.smartItemEntity.data.isVisible) {
      this.setEnabled(updatedEntity.data.isVisible);
    }

    // toggle physics collision
    if (
      updatedEntity.data.checkCollisions !==
      this.smartItemEntity.data.checkCollisions
    ) {
      this.attachedMeshes
        .filter((mesh) => mesh.id === this.smartItemEntity.id)
        .forEach((mesh: Mesh | AbstractMesh) => {
          if (mesh instanceof AbstractMesh) {
            mesh.checkCollisions = updatedEntity.data.checkCollisions;
          }
        });
    }

    // update pivot point
    this.pivot.updatePivotPoint(
      {
        x: updatedEntity.data.transform.pivotPosition.x,
        y: updatedEntity.data.transform.pivotPosition.y,
        z: updatedEntity.data.transform.pivotPosition.z,
      },
      false
    );

    // update transform
    this.updateTransform(updatedEntity.data.transform);

    // update collision box props
    this.collisionBox.updateCollisionBoxProps(updatedEntity);

    // update gizmo props
    this.gizmo.updateGizmoProps(updatedEntity);

    // update sound props
    this.sound.updateSoundProps(updatedEntity);
  }

  updateMeshesMetadata(updatedEntity: SmartItemVM) {
    // update class metadata
    try {
      this.smartItemEntity = snapshot(updatedEntity);
    } catch (er) {
      this.smartItemEntity = updatedEntity;
    }
    // update attached meshes metadata
    this.attachedMeshes.forEach((mesh: Mesh | AbstractMesh) => {
      mesh.metadata = this.smartItemEntity;
    });

    // update collision box metadata
    this.collisionBox.updateCollisionBoxMetadata();
  }

  updateTransform(transform: SmartItemTransform, force = false) {
    if (
      this.smartItemEntity.data.transform.position.x !== transform.position.x ||
      this.smartItemEntity.data.transform.position.y !== transform.position.y ||
      this.smartItemEntity.data.transform.position.z !== transform.position.z ||
      force
    ) {
      this.setPosition(transform.position);
    }

    if (
      this.smartItemEntity.data.transform.rotation.x !== transform.rotation.x ||
      this.smartItemEntity.data.transform.rotation.y !== transform.rotation.y ||
      this.smartItemEntity.data.transform.rotation.z !== transform.rotation.z ||
      force
    ) {
      this.setRotation(transform.rotation);
    }

    if (
      this.smartItemEntity.data.transform.scale.coefficient !==
        transform.scale.coefficient ||
      this.smartItemEntity.data.transform.scale.x !== transform.scale.x ||
      this.smartItemEntity.data.transform.scale.y !== transform.scale.y ||
      this.smartItemEntity.data.transform.scale.z !== transform.scale.z ||
      force
    ) {
      this.setScale(transform.scale);
    }
  }

  setScale(scale: SmartItemScale) {
    let x = scale.x * scale.coefficient;
    let y = scale.y * scale.coefficient;
    let z = scale.z * scale.coefficient;

    this.transformMesh.scaling = new Vector3(x, y, z);

    // change rotation gizmo settings
    this.gizmo.toggleRotationGizmoSettings();
  }

  setPosition(position: Vec3) {
    this.transformMesh.position.copyFrom(
      new Vector3(...Object.values(position))
    );
  }

  setRotation(rotation: Vec3) {
    const newRotation = new Vector3(
      ...Object.values(rotation).map((value) => Tools.ToRadians(value))
    );
    this.transformMesh.rotationQuaternion = newRotation.toQuaternion();
  }

  setEnabled(enabled: boolean) {
    this.transformMesh.setEnabled(enabled);
  }

  disable() {
    this.transformMesh.setEnabled(false);
  }

  dispose() {
    this.gizmo.detachGizmo();
    this.transformMesh.dispose();
    this.collisionBox.dispose();
    this.sound.dispose();
  }

  private distanceHelper?: Mesh;
  private distanceHelperCreated = false;
  private hideDistanceHelper: DebouncedFunc<() => void>;

  showDistanceHelper(position: Vec3, distance: number) {
    // create distance helper
    if (!this.distanceHelperCreated) {
      this.distanceHelperCreated = true;
      this.distanceHelper = MeshBuilder.CreateDisc(
        `${this.smartItemEntity.data.title} DistanceHelper`,
        {
          radius: 1,
        }
      );
      this.distanceHelper.rotation.x = Math.PI / 2;
      this.distanceHelper.alphaIndex = 1;
      const material = new StandardMaterial(
        `${this.smartItemEntity.data.title} DistanceHelperMaterial`
      );
      material.diffuseColor = new Color3(19 / 255, 92 / 255, 83 / 255);
      material.specularColor = new Color3(0, 0, 0);
      material.alpha = 0.5;
      this.distanceHelper.material = material;
    }

    // update distance helper
    if (this.distanceHelper) {
      this.distanceHelper.visibility = 1;
      this.distanceHelper.position = new Vector3(...Object.values(position));
      this.distanceHelper.scaling.x = distance;
      this.distanceHelper.scaling.y = distance;
    }

    // hide
    this.hideDistanceHelper?.cancel();
    this.hideDistanceHelper = debounce(() => {
      if (this.distanceHelper) {
        this.distanceHelper.visibility = 0;
      }
    }, 7000);

    this.hideDistanceHelper();
  }
}
