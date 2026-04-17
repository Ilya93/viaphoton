import {
  AbstractMesh,
  Animation,
  AnimationGroup,
  ArcRotateCamera,
  Color3,
  DeepImmutable,
  DynamicTexture,
  ICrowd,
  Matrix,
  Mesh,
  MeshBuilder,
  Node,
  Observer,
  PBRMaterial,
  PickingInfo,
  PointerEventTypes,
  PointerInfo,
  Ray,
  RecastJSPlugin,
  Scene,
  SceneLoader,
  Skeleton,
  StandardMaterial,
  TargetedAnimation,
  Texture,
  Tools,
  TransformNode,
  Vector3,
  int,
} from "@babylonjs/core";
import earcut from "earcut";
import * as R from "ramda";
import { SceneService } from "../../services/scene.service";
import { SmartItemVM } from "../../../store/smart-items/smart-items.models";
import { AvatarService } from "../../services/avatar.service";
import { ColyseusNetwork } from "../../network/ColyseusNetwork";

export class CharacterController {
  public _avatar: Mesh = null;
  public _skeleton: Skeleton = null;
  public _camera: ArcRotateCamera;
  public nickname: Mesh;
  public emoji: Mesh = null;
  public emojiText: string = "";
  public emojiTimeout: NodeJS.Timeout;
  public _scene: Scene;

  protected _gravity: number = 9.8;
  //slopeLimit in degrees
  protected _minSlopeLimit: number = 30;
  protected _maxSlopeLimit: number = 45;
  //slopeLimit in radians
  protected _sl1: number = (Math.PI * this._minSlopeLimit) / 180;
  protected _sl2: number = (Math.PI * this._maxSlopeLimit) / 180;

  //The av will step up a stair only if it is closer to the ground than the indicated value.
  protected _stepOffset: number = 0.25;
  //toal amount by which the av has moved up
  protected _vMoveTot: number = 0;
  //position of av when it started moving up
  protected _vMovStartPos: Vector3 = Vector3.Zero();

  protected _actionMap: ActionMap = new ActionMap();

  protected _cameraElastic: boolean = true;
  protected _cameraTarget: Vector3 = Vector3.Zero();
  //should we go into first person view when camera is near avatar (radius is lowerradius limit)
  protected _noFirstPerson: boolean = false;
  protected animationTimeout: NodeJS.Timeout = null;

  public setSlopeLimit(minSlopeLimit: number, maxSlopeLimit: number) {
    this._minSlopeLimit = minSlopeLimit;
    this._maxSlopeLimit = maxSlopeLimit;

    this._sl1 = (Math.PI * this._minSlopeLimit) / 180;
    this._sl2 = (Math.PI * this._maxSlopeLimit) / 180;
  }
  public setStepOffset(stepOffset: number) {
    this._stepOffset = stepOffset;
  }
  public setWalkSpeed(n: number) {
    this._actionMap.walk.speed = n;
  }
  public setRunSpeed(n: number) {
    this._actionMap.run.speed = n;
  }

  /**
   * Use this to provide animationGroups to the character controller.
   * Provide the AnimationGroups using a Map
   * In this Map the key would be the character controller animation name and
   * the key value would be the animationGroup.
   * Example:
   * let myWalkAnimationGroup:AnimationGroup = ...;
   * let agMap:{} = {
   *  "walk":myWalkAnimationGroup,
   *  "run" : {"ag":myRunAnimationGroup,"rate":1},
   *  "idle" : {"ag":myIdleAnimationGroup,"loop":true,"rate":1},
   *  ....
   *   ....
   * }
   *
   * @param agMap a map of character controller animation name to animationGroup
   */
  public setAnimationGroups(agMap: {}) {
    if (this._prevAnim != null && this._prevAnim.exist)
      this._prevAnim.ag.stop();
    this._isAG = true;
    this.setActionMap(<ActionMap>agMap);
  }

  /**
   * updates action data in the cc actionMap
   * with action data from the provided/input actionMap
   *
   *
   * return "ar" or "ag" depending on if the data provided
   * was animation range or animation group data respt.
   *
   * TODO should validate provided data.
   * In other words if animation range provided make sure
   * the range exist in the skeleton
   * or if animation group provided make sure the animation group
   * can be played on this avataor
   *
   * @param inActMap
   * @returns
   */
  public setActionMap(inActMap: ActionMap): string {
    let agMap: boolean = false;
    let inActData: ActionData;

    let ccActionNames: string[] = Object.keys(this._actionMap);
    for (let ccActionName of ccActionNames) {
      let ccActData = this._actionMap[ccActionName];
      //some keys could map to functions (like reset())
      if (!(ccActData instanceof ActionData)) continue;
      ccActData.exist = false;

      inActData = inActMap[ccActData.id];
      //in previous version of cc the key value was AnimationGroup rather than ActionData
      //lets accomodate that for backward compatibility
      if (inActData != null) {
        if (inActData instanceof AnimationGroup) {
          ccActData.ag = inActData;
          ccActData.name = ccActData.ag.name;
          ccActData.exist = true;
          agMap = true;
          this._hasAnims = true;
        } else if (inActData.exist) {
          this._hasAnims = true;
          ccActData.exist = true;
          if (inActData instanceof Object) {
            if (inActData.ag) {
              ccActData.ag = inActData.ag;
              agMap = true;
            }
            if (inActData.name) {
              ccActData.name = inActData.name;
            }
            if (inActData.loop != null) ccActData.loop = inActData.loop;
            if (inActData.rate) ccActData.rate = inActData.rate;
            if (inActData.speed) ccActData.speed = inActData.speed;
            // if (actDataI.key) actDataO.key = actDataI.key;
            if (inActData.sound) ccActData.sound = inActData.sound;
          } else {
            ccActData.name = inActData;
          }
        }
      }
    }
    //force to play new anims
    this._prevAnim = null;
    if (agMap) return "ag";
    else return "ar";
  }

  protected _setAnim(
    anim: ActionData,
    animName?: string | AnimationGroup,
    rate?: number,
    loop?: boolean,
  ) {
    //animation range need skeleton
    if (!this._isAG && this._skeleton == null) return;
    if (animName != null) {
      if (this._isAG) {
        if (!(animName instanceof AnimationGroup)) return;
        anim.ag = <AnimationGroup>animName;
        anim.exist = true;
      } else {
        if (this._skeleton.getAnimationRange(anim.name) != null) {
          anim.name = <string>animName;
          anim.exist = true;
        } else {
          anim.exist = false;
          return;
        }
      }
    }

    if (loop != null) anim.loop = loop;
    if (rate != null) anim.rate = rate;
  }

  public enableBlending(n: number) {
    if (this._isAG) {
      let keys: string[] = Object.keys(this._actionMap);
      for (let key of keys) {
        let act = this._actionMap[key];
        if (!(act instanceof ActionData)) continue;
        if (act.exist) {
          let ar: AnimationGroup = act.ag;
          if (ar.name.indexOf("jump") !== -1) return; // jump start immediately
          if (ar.name.indexOf("idle") !== -1) n = 0.075; // slow down idle
          for (let ta of ar.targetedAnimations) {
            ta.animation.enableBlending = true;
            ta.animation.blendingSpeed = n;
          }
        }
      }
    } else {
      if (this._skeleton !== null) this._skeleton.enableBlending(n);
    }
  }

  public setCameraElasticity(b: boolean) {
    this._cameraElastic = b;
  }
  public setElasticiSteps(n: number) {
    this._elasticSteps = n;
  }

  public makeObstructionInvisible(b: boolean) {
    this._makeInvisible = b;
  }
  public setCameraTarget(v: Vector3) {
    this._cameraTarget.copyFrom(v);
  }

  public createTextMesh(
    string: string,
    size: number,
    height: number,
    heightPolygon: number,
  ) {
    // Set height for plane
    const planeHeight = height;

    // Set font
    const font_size = size;
    const font = font_size + "px Poppins";

    // Set height for dynamic texture
    const DTHeight = 3 * font_size;

    // Use a dynamic texture to calculate the length of the text on the dynamic texture canvas
    const temp = new DynamicTexture("DynamicTexture", 64, this._scene);
    const tmpctx = temp.getContext();
    tmpctx.font = font;

    // Set height for dynamic texture
    const DTWidth = tmpctx.measureText(string).width * 3;

    // Calculate ratio
    const ratio = planeHeight / DTHeight;
    const planeWidth = DTWidth * ratio;

    const polygon = this.createPolygon(string, heightPolygon);
    polygon.checkCollisions = false;
    polygon.parent = this._avatar;

    // calculate nickname height
    const sizes = this._avatar.getHierarchyBoundingVectors();
    const nicknameHeight = sizes.max.y - sizes.min.y + 0.15;

    // set nickname position
    polygon.position = new Vector3(0, -nicknameHeight, 0);

    polygon.billboardMode = Mesh.BILLBOARDMODE_ALL;

    const text = MeshBuilder.CreatePlane(
      "text",
      {
        width: planeWidth,
        height: planeHeight,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      this._scene,
    );
    text.checkCollisions = false;
    text.parent = polygon;
    text.position = new Vector3(0, 0, 0);
    text.billboardMode = Mesh.BILLBOARDMODE_ALL;

    // Create dynamic texture and write the text
    const dynamicTexture = new DynamicTexture(
      "DynamicTexture",
      { width: DTWidth, height: DTHeight },
      this._scene,
      false,
    );
    dynamicTexture.drawText(string, null, null, font, "#fff", "", false);

    const mat = new StandardMaterial("mat", this._scene);
    mat.diffuseTexture = dynamicTexture;
    mat.opacityTexture = mat.diffuseTexture;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0, 0, 0);
    text.material = mat;

    // Create materials
    const glass = new PBRMaterial("glass", this._scene);
    glass.indexOfRefraction = 0.52;
    glass.alpha = 0.5;
    glass.directIntensity = 0.0;
    glass.environmentIntensity = 0.7;
    glass.cameraExposure = 0.66;
    glass.cameraContrast = 1.66;
    glass.microSurface = 1;
    glass.reflectivityColor = new Color3(0.2, 0.2, 0.2);
    glass.albedoColor = new Color3(0.95, 0.95, 0.95);

    polygon.material = glass;
    polygon.rotation = new Vector3(Math.PI / 2, 0, 0);
    return polygon;
  }

  public createPolygon(text: string, height = 0.1) {
    // Set font
    const font_size = 48;
    const font = font_size + "px Poppins";

    const linesLength = Math.ceil(text.length / 50);

    // Set height for plane
    const planeHeight = height;

    // Set height for dynamic texture
    const DTHeight = 1.2 * font_size;

    // Use a dynamic texture to calculate the length of the text on the dynamic texture canvas
    const temp = new DynamicTexture("DynamicTexture", 64, this._scene);
    const tmpctx = temp.getContext();
    tmpctx.font = font;

    const DTWidth =
      linesLength > 1
        ? tmpctx.measureText(text.slice(0, 50)).width * 0.8
        : tmpctx.measureText(text).width * 0.8;

    // Calculate ratio
    const ratio = planeHeight / DTHeight;

    // Calculate the plane width
    const planeWidth = DTWidth * ratio;

    //Polygon shape in XoZ plane
    const shape = [];

    const width = planeWidth < 0.18 ? 0.18 : planeWidth;
    const depth = planeHeight;

    const radius = depth / 2;
    const dTheta = Math.PI / 16;

    //bottom left corner
    let centerX = -(0.5 * width - radius);
    let centerZ = -(0.5 * depth - radius);
    for (let theta = Math.PI; theta <= 1.5 * Math.PI; theta += dTheta) {
      shape.push(
        new Vector3(
          centerX + radius * Math.cos(theta),
          0,
          centerZ + radius * Math.sin(theta),
        ),
      );
    }

    //bottom right corner
    centerX = 0.5 * width - radius;
    for (let theta = 1.5 * Math.PI; theta <= 2 * Math.PI; theta += dTheta) {
      shape.push(
        new Vector3(
          centerX + radius * Math.cos(theta),
          0,
          centerZ + radius * Math.sin(theta),
        ),
      );
    }

    //top right corner
    centerZ = 0.5 * depth - radius;
    for (let theta = 0; theta <= 0.5 * Math.PI; theta += dTheta) {
      shape.push(
        new Vector3(
          centerX + radius * Math.cos(theta),
          0,
          centerZ + radius * Math.sin(theta),
        ),
      );
    }

    //top left corner
    centerX = -(0.5 * width - radius);
    for (let theta = 0.5 * Math.PI; theta <= Math.PI; theta += dTheta) {
      shape.push(
        new Vector3(
          centerX + radius * Math.cos(theta),
          0,
          centerZ + radius * Math.sin(theta),
        ),
      );
    }
    const mesh = MeshBuilder.CreatePolygon(
      "UserNickname",
      {
        shape: shape,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      this._scene,
      earcut,
    );
    return mesh;
  }

  public setNicknameBillboard(nick: string) {
    if (this.nickname) this.nickname.dispose();
    let nickname = nick;

    if (nickname.length > 10) nickname = `${nickname.substring(0, 15)}...`;

    const nicknameMesh = this.createTextMesh(nick, 48, 0.15, 0.1);

    this.nickname = nicknameMesh;
  }

  public setNoFirstPerson(b: boolean) {
    this._noFirstPerson = b;
  }

  /**
   * Use this to set  turning off.
   * When turining is off
   * a) turn left or turn right keys result in avatar facing and moving left or right with respect to camera.
   * b) walkback/runback key results in avatar facing back and walking/running towards camera.
   *
   * This setting has no effect when mode is 1.
   *
   * @param b
   */
  public setTurningOff(b: boolean) {
    this._noRot = b;
  }

  // network system reference
  public _networkSystem: ColyseusNetwork;

  /**
   * checks if a have left hand , right hand issue.
   * In other words if a mesh is a LHS mesh in RHS system or
   * a RHS mesh in LHS system
   * The X axis will be reversed in such cases.
   * thus Cross product of X and Y should be inverse of Z.
   * BABYLONJS GLB models are RHS and exhibit this behavior
   *
   */
  protected _isRHS = false;
  protected _signRHS = -1;
  protected _setRHS(mesh: TransformNode) {
    const meshMatrix: Matrix = mesh.getWorldMatrix();
    const _localX = Vector3.FromFloatArray(
      <DeepImmutable<Float32Array>>meshMatrix.m,
      0,
    );
    const _localY = Vector3.FromFloatArray(
      <DeepImmutable<Float32Array>>meshMatrix.m,
      4,
    );
    const _localZ = Vector3.FromFloatArray(
      <DeepImmutable<Float32Array>>meshMatrix.m,
      8,
    );
    const actualZ = Vector3.Cross(_localX, _localY);
    //same direction or opposite direction of Z
    if (Vector3.Dot(actualZ, _localZ) < 0) {
      this._isRHS = true;
      this._signRHS = 1;
    } else {
      this._isRHS = false;
      this._signRHS = -1;
    }
  }

  /**
   * Use setFaceForward(true|false) to indicate that the avatar face  faces forward (true) or backward (false).
   * The avatar face faces forward if its face points to positive local Z axis direction
   */
  protected _ffSign: number;
  protected _ff: boolean;
  //in mode 0, av2cam is used to align avatar with camera , with camera always facing avatar's back
  //note:camera alpha is measured anti-clockwise , avatar rotation is measured clockwise
  public _av2cam;
  public setFaceForward(b: boolean) {
    this._ff = b;
    if (this._isRHS) {
      this._av2cam = b ? Math.PI / 2 : (3 * Math.PI) / 2;
      this._ffSign = b ? 1 : -1;
    } else {
      this._av2cam = b ? (3 * Math.PI) / 2 : Math.PI / 2;
      this._ffSign = b ? -1 : 1;
    }
  }

  // check if any of the mesh on the node tree has any aniamtion group
  protected _containsAG(node: Node, ags: AnimationGroup[], fromRoot: boolean) {
    let r: Node;
    let ns: Node[];

    if (fromRoot) {
      r = this._getRoot(node);
      ns = r.getChildren((n) => {
        return n instanceof TransformNode;
      }, false);
    } else {
      r = node;
      ns = [r];
    }
    for (let ag of ags) {
      let tas: TargetedAnimation[] = ag.targetedAnimations;
      for (let ta of tas) {
        if (ns.indexOf(ta.target) > -1) {
          return true;
        }
      }
    }
    return false;
  }

  //get the root of Node
  protected _getRoot(tn: Node): Node {
    if (tn.parent == null) return tn;
    return this._getRoot(tn.parent);
  }

  public _started: boolean = false;

  public start() {
    if (this._started) return;
    this._started = true;
    this._act.reset();
    this._movFallTime = 0;
    //first time we enter render loop, delta time is zero
    this._idleFallTime = 0.001;
    this._grounded = false;
    this._updateTargetValue();
    this.enableKeyBoard(true);
    this._scene.registerBeforeRender(this._renderer);
  }

  public stop() {
    if (!this._started) return;
    this._started = false;
    this._scene.unregisterBeforeRender(this._renderer);
    this.enableKeyBoard(false);
    this._prevAnim = null;
    this._isRecastWalkActive = false;
    this.pointerMesh?.setEnabled(false);
  }

  protected _prevAnim: ActionData = null;
  protected _avStartPos: Vector3 = Vector3.Zero();
  protected _grounded: boolean = false;
  //distance by which AV would move down if in freefall
  protected _freeFallDist: number = 0;

  //how many minimum contiguos frames should the AV have been in free fall
  //before we assume AV is in big freefall.
  //we will use this to remove animation flicker during move down a slope (fall, move, fall move etc)
  //TODO: base this on slope - large slope large count
  protected _fallFrameCountMin: number = 150;
  protected _fallFrameCount: number = 0;

  //how many minimum contiguos frames should the AV have been in movement
  //before we start move with collision.
  // used to sync with animation blending
  protected _moveFrameCountMin: number = 10;
  protected _moveFrameCount: number = 0;

  protected _inFreeFall: boolean = false;
  protected _wasWalking: boolean = false;
  protected _wasRunning: boolean = false;
  protected _moveVector: Vector3;

  //used only in mode 1
  //value 1 or -1 , -1 if avatar is facing camera
  //protected _notFacingCamera = 1;

  protected _isAvFacingCamera(): number {
    if (
      Vector3.Dot(
        this._avatar.forward,
        this._avatar.position.subtract(this._camera.position),
      ) < 0
    )
      return 1;
    else return -1;
  }

  public pointerMesh: TransformNode;
  protected createPoiterMesh(): TransformNode {
    const pointer = new TransformNode("pointer", this._scene);

    const torus = MeshBuilder.CreateTorus(
      "torus",
      {
        diameter: 12,
        thickness: 0.5,
        tessellation: 60,
        updatable: false,
      },
      this._scene,
    );
    torus.parent = pointer;

    const torus2 = MeshBuilder.CreateTorus(
      "torus",
      {
        diameter: 8,
        thickness: 0.5,
        tessellation: 60,
        updatable: false,
      },
      this._scene,
    );
    torus2.parent = pointer;

    const torus3 = MeshBuilder.CreateTorus(
      "torus",
      {
        diameter: 4,
        thickness: 0.5,
        tessellation: 60,
        updatable: false,
      },
      this._scene,
    );
    torus3.parent = pointer;
    pointer.setEnabled(false);

    pointer.scaling = new Vector3(0.1, 0.01, 0.1);

    const animationBox = new Animation(
      "pointerAnimation",
      "scaling.x",
      100,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE,
    );
    const animationBox1 = new Animation(
      "pointerAnimation1",
      "scaling.z",
      100,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE,
    );

    // An array with all animation keys
    const keys = [];
    //At the animation key 0, the value of scaling is "1"
    keys.push({
      frame: 0,
      value: 0.1,
    });
    //At the animation key 20, the value of scaling is "0.2"
    keys.push({
      frame: 20,
      value: 0.2,
    });
    keys.push({
      frame: 60,
      value: 0.3,
    });
    //At the animation key 100, the value of scaling is "1"
    keys.push({
      frame: 100,
      value: 0.1,
    });

    animationBox.setKeys(keys);
    animationBox1.setKeys(keys);
    torus.animations = [];
    torus.animations.push(animationBox);
    torus.animations.push(animationBox1);

    torus2.animations = [];
    torus2.animations.push(animationBox);
    torus2.animations.push(animationBox1);

    torus3.animations = [];
    torus3.animations.push(animationBox);
    torus3.animations.push(animationBox1);

    this._scene.beginAnimation(torus, 0, 100, true);
    this._scene.beginAnimation(torus2, 0, 100, true, 2);
    this._scene.beginAnimation(torus3, 0, 100, true, 3);

    const tubePath = [
      new Vector3(0, 28, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
    ];
    let tube = MeshBuilder.CreateTube("tube", {
      path: tubePath,
      radius: 0.05,
      sideOrientation: Mesh.DOUBLESIDE,
    });
    var groundMtl = new StandardMaterial("ground", this._scene);
    var alphaTexture = new Texture("/assets/texture.png", this._scene);
    groundMtl.diffuseTexture = alphaTexture;
    groundMtl.diffuseTexture.hasAlpha = true;
    groundMtl.diffuseColor = Color3.Black();
    groundMtl.useAlphaFromDiffuseTexture = true;
    groundMtl.alphaMode = 1;
    groundMtl.emissiveColor = new Color3(1, 1, 1);
    groundMtl.useEmissiveAsIllumination = true;
    tube.material = groundMtl;
    tube.parent = pointer;

    const animationTube = new Animation(
      "pointerAnimation3",
      "position",
      100,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CYCLE,
    );

    animationTube.setKeys([
      {
        frame: 0,
        value: new Vector3(0, 0, 0),
      },
      {
        frame: 55,
        value: new Vector3(0, 3, 0),
      },
      {
        frame: 100,
        value: new Vector3(0, 0, 0),
      },
    ]);
    tube.animations = [];
    tube.animations.push(animationTube);
    this._scene.beginAnimation(tube, 0, 100, true);

    return pointer;
  }

  protected _playerRecastAgent: RecastAgent;
  protected _isTargetPointReached = true;
  protected _isRecastWalkActive = false;
  protected _recastPargetPointsArray: Vector3[] = [];
  protected _distanceToWalk: number;
  protected _distanceWalked: number = 0;
  protected _crowd: ICrowd;
  protected _recast = new RecastJSPlugin();

  async buildNavMesh(callback?: Function): Promise<Uint8Array> {
    const spaceMesh = this._scene.getMeshById("space") as Mesh;
    const groundMesh = this._scene.getMeshById("GroundGrid") as Mesh;
    const navmeshInputMeshes = groundMesh
      ? [groundMesh]
      : [...((spaceMesh?.getChildMeshes() as Mesh[]) || [])];

    this._recast.setWorkerURL("/workers/navMeshWorker.js");

    var navmeshParameters = {
      cs: 0.3,
      ch: 0.45,
      walkableSlopeAngle: 35,
      walkableHeight: 1,
      walkableClimb: 1,
      walkableRadius: 1,
      maxEdgeLen: 12,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    };

    return new Promise((resolve) => {
      this._recast.createNavMesh(
        navmeshInputMeshes,
        navmeshParameters,
        (navmeshData) => {
          if (callback) {
            callback(navmeshData);
          }
          resolve(navmeshData);
        },
      );
    });
  }

  private _cachedNavmesh: Uint8Array;
  private _pointerObserver: Observer<PointerInfo>;
  async setNavMesh(
    savedNavmesh?: string | false,
    saveNavmeshCallback?: Function,
  ) {
    const player = this._avatar;

    const navmeshClickHandler = (navmeshData) => {
      // build nav mesh
      this._recast.buildFromNavmeshData(navmeshData);

      this.pointerMesh = this.createPoiterMesh();

      // debug nav mesh
      // var navmeshdebug = this._recast.createDebugNavMesh(this._scene);
      // navmeshdebug.position = new Vector3(0, 0, 0);
      // var matdebug = new StandardMaterial("matdebug", this._scene);
      // matdebug.diffuseColor = new Color3(0.1, 0.2, 1);
      // matdebug.alpha = 0.2;
      // navmeshdebug.material = matdebug;

      // add recast crowd
      this._crowd = this._recast.createCrowd(1, 0.5, this._scene);

      // add recast agent
      const transformNode = new TransformNode("recast");
      const agentParams = {
        radius: 0.5,
        height: 0.2,
        maxAcceleration: 4.0,
        maxSpeed: 2.5,
        collisionQueryRange: 0.5,
        pathOptimizationRange: 0.0,
        separationWeight: 1.0,
      };
      const agentIndex = this._crowd.addAgent(
        player.position,
        agentParams,
        transformNode,
      );
      this._playerRecastAgent = {
        idx: agentIndex,
        trf: transformNode,
        mesh: player,
      };

      // detect mouse click
      if (!this._pointerObserver) {
        const maxDeltaMouseMove = 12;
        let pointerdownCoords;
        // pick point and move player to it
        const pickAndMove = () => {
          let targetPoint = null;
          let pathLine = null;

          const pickinfo = this._scene.pick(
            this._scene.pointerX,
            this._scene.pointerY,
            (mesh) => {
              // filter out smart item meshes (besides poll and button)
              const { metadata, id } = mesh;
              return (
                (mesh.isPickable || metadata?.data?.type === "gltfSpaceMesh") &&
                (!metadata?.data?.type ||
                  metadata.data.type.indexOf("smart-item") === -1 ||
                  (metadata?.data?.type?.indexOf("smart-item/") > -1 &&
                    id !== "CollisionBox"))
              );
            },
          );

          if (pickinfo?.hit) {
            targetPoint = pickinfo.pickedPoint;

            // skip movement if poll or button is clicked
            const { metadata } = pickinfo.pickedMesh;
            if (
              metadata?.data?.type?.indexOf("smart-item/poll") > -1 ||
              metadata?.data?.type?.indexOf("smart-item/video") > -1 ||
              metadata?.data?.type?.indexOf("smart-item/live-streaming") > -1 ||
              metadata?.data?.type?.indexOf("smart-item/button") > -1
            )
              return;
          }

          if (targetPoint) {
            if (!this._isTargetPointReached) {
              // move recast agent to current avatar position
              this._crowd.agentTeleport(
                this._playerRecastAgent.idx,
                this._avatar.position,
              );

              // clear walked distance
              this._distanceWalked = 0;
            }

            // calculate path points using recast
            const closestPoint = this._recast.getClosestPoint(targetPoint);
            const pathPoints = this._recast.computePath(
              this._crowd.getAgentPosition(this._playerRecastAgent.idx),
              closestPoint,
            );
            const destinationPoint = pathPoints[pathPoints.length - 1];

            // move user if path destination is correct
            if (
              destinationPoint &&
              !destinationPoint.equals(this._avatar.position) &&
              !destinationPoint.equals(new Vector3(0, 0, 0))
            ) {
              this.stopCustomAnimations();
              this._isRecastWalkActive = true;
              const pathArray = [...pathPoints];

              // remove start point
              pathArray.shift();

              this._recastPargetPointsArray = pathArray;

              // calc distacne
              this._distanceWalked = 0;
              this._distanceToWalk = Vector3.Distance(
                this._avatar.position,
                this._recastPargetPointsArray[0],
              );

              // pick ground at destination point
              var ray = new Ray(destinationPoint, new Vector3(0, -1, 0), 1);
              var pickInfo = this._scene.pickWithRay(ray, (mesh) => {
                // filter out smart item meshes
                const { metadata } = mesh;
                return (
                  !metadata?.data?.type ||
                  metadata.data.type.indexOf("smart-item") === -1
                );
              });

              if (pickInfo.pickedPoint) {
                // set position to picked ground point
                this.pointerMesh.position.copyFrom(pickInfo.pickedPoint);
              } else {
                // fallback
                this.pointerMesh.position.copyFrom(
                  destinationPoint.addInPlace(new Vector3(0, -0.2, 0)),
                );
              }

              this.pointerMesh.setEnabled(true);
              // rotate avatar mesh to next target point
              const point = this._recastPargetPointsArray.shift();
              this._avatar.lookAt(point, Tools.ToRadians(180));
              this._avatar.rotation.x = 0;
            }

            // // debug path line
            // pathLine = MeshBuilder.CreateDashedLines(
            //   "ribbon",
            //   { points: pathPoints, updatable: true, instance: pathLine },
            //   this._scene
            // );
          }
        };

        this._pointerObserver = this._scene.onPointerObservable.add(
          (pointerInfo) => {
            if (this.isEditMode) return;
            switch (pointerInfo.type) {
              case PointerEventTypes.POINTERDOWN:
                if (pointerInfo.event.button > 0 || !this._started) return;
                pointerdownCoords = {
                  pointerX: this._scene.pointerX,
                  pointerY: this._scene.pointerY,
                };
                break;
              case PointerEventTypes.POINTERUP:
                if (pointerInfo.event.button > 0 || !pointerdownCoords) return;
                if (
                  Math.abs(this._scene.pointerX - pointerdownCoords.pointerX) <=
                    maxDeltaMouseMove &&
                  Math.abs(this._scene.pointerY - pointerdownCoords.pointerY) <=
                    maxDeltaMouseMove
                ) {
                  pickAndMove();
                }

                break;
            }
          },
          PointerEventTypes.POINTERDOWN | PointerEventTypes.POINTERUP,
        );
      }
    };

    if (
      !this._cachedNavmesh &&
      savedNavmesh &&
      savedNavmesh !== "" &&
      savedNavmesh !== "undefined"
    ) {
      const navmeshData = Uint8Array.from(
        savedNavmesh.split(",").map((x) => parseInt(x, 10)),
      );
      this._cachedNavmesh = navmeshData;
      navmeshClickHandler(this._cachedNavmesh);
    } else if (this._cachedNavmesh) {
      navmeshClickHandler(this._cachedNavmesh);
    } else {
      const navmeshData = await this.buildNavMesh(saveNavmeshCallback);
      this._cachedNavmesh = navmeshData;
      navmeshClickHandler(navmeshData);
    }
  }

  protected _moveAVandCamera() {
    this._avStartPos.copyFrom(this._avatar.position);
    let anim: ActionData = null;
    const dt: number = this._scene.getEngine().getDeltaTime() / 1000;

    if (this._act._jump && !this._inFreeFall) {
      this._grounded = false;
      this._idleFallTime = 0;
      anim = this._doJump(dt);
    } else if (
      this.anyMovement() ||
      this._inFreeFall ||
      this._isRecastWalkActive
    ) {
      // recast movement logic
      if (this._isRecastWalkActive) {
        this._isTargetPointReached =
          this._distanceWalked >= this._distanceToWalk;

        if (this._isTargetPointReached) {
          if (this._recastPargetPointsArray.length) {
            // calc distance
            this._distanceToWalk = Vector3.Distance(
              this._avatar.position,
              this._recastPargetPointsArray[0],
            );

            // rotate avatar mesh to next target point
            this._avatar.lookAt(
              this._recastPargetPointsArray[0],
              Tools.ToRadians(180),
            );
            this._avatar.rotation.x = 0;

            // remove reached point from array
            this._recastPargetPointsArray.shift();

            // clear walked distance
            this._distanceWalked = 0;
          } else {
            this._isRecastWalkActive = false;
            this.pointerMesh.setEnabled(false);
            // move recast agent to current avatar position
            this._crowd.agentTeleport(
              this._playerRecastAgent.idx,
              this._avatar.position,
            );
          }
        }
      }

      this._grounded = false;
      this._idleFallTime = 0;
      anim = this._doMove(dt);
    } else if (!this._inFreeFall) {
      anim = this._doIdle(dt);
    }
    if (this._hasAnims && anim != null) {
      if (this._prevAnim !== anim) {
        if (anim.exist) {
          if (this._isAG) {
            if (this._prevAnim != null && this._prevAnim.exist)
              this._prevAnim.ag.stop();
            anim.ag.start(anim.loop, anim.rate);
          } else {
            this._skeleton.beginAnimation(anim.name, anim.loop, anim.rate);
          }
        }
        this._prevAnim = anim;
      }
    }
    this._updateTargetValue();

    return;
  }

  //verical position of AV when it is about to start a jump
  protected _jumpStartPosY: number = 0;
  //for how long the AV has been in the jump
  protected _jumpTime: number = 0;
  protected _doJump(dt: number): ActionData {
    let anim: ActionData = null;
    anim = this._actionMap.runJump;
    if (this._jumpTime === 0) {
      this._jumpStartPosY = this._avatar.position.y;
    }

    this._jumpTime = this._jumpTime + dt;

    let forwardDist: number = 0;
    let jumpDist: number = 0;
    let disp: Vector3;
    if (this._wasRunning || this._wasWalking) {
      if (this._wasRunning) {
        forwardDist = this._actionMap.run.speed * dt;
      } else if (this._wasWalking) {
        forwardDist = this._actionMap.walk.speed * dt;
      }
      //find out in which horizontal direction the AV was moving when it started the jump
      disp = this._moveVector.clone();
      disp.y = 0;
      disp = disp.normalize();
      disp.scaleToRef(forwardDist, disp);
      jumpDist = this._calcJumpDist(this._actionMap.runJump.speed, dt);
      disp.y = jumpDist;
    } else {
      jumpDist = this._calcJumpDist(this._actionMap.idleJump.speed, dt);
      disp = new Vector3(0, jumpDist, 0);
      anim = this._actionMap.idleJump;
      //this.avatar.ellipsoid.y=this._ellipsoid.y/2;
    }
    //moveWithCollision only seems to happen if length of displacment is atleast 0.001
    this._avatar.moveWithCollisions(disp);
    if (jumpDist < 0) {
      //this.avatar.ellipsoid.y=this._ellipsoid.y;
      //check if going up a slope or back on flat ground
      if (
        this._avatar.position.y > this._avStartPos.y ||
        (this._avatar.position.y === this._avStartPos.y &&
          disp.length() > 0.001)
      ) {
        this._endJump();
      } else if (this._avatar.position.y + 0.1 < this._jumpStartPosY) {
        //the avatar is below the point from where it started the jump
        //so it is either in free fall or is sliding along a downward slope
        //
        //if the actual displacemnt is same as the desired displacement then AV is in freefall
        //else it is on a slope
        const actDisp: Vector3 = this._avatar.position.subtract(
          this._avStartPos,
        );
        if (!this._areVectorsEqual(actDisp, disp, 0.001)) {
          //AV is on slope
          //Should AV continue to slide or stop?
          //if slope is less steeper than acceptable then stop else slide
          if (this._verticalSlope(actDisp) <= this._sl1) {
            this._endJump();
          }
        } else {
          console.log("avatar in free fall");
          // anim = this._actionMap.fall;

          // tem use idle for fall animation
          anim = this._actionMap.idle;
        }
      }
    }
    return anim;
  }

  protected _calcJumpDist(speed: number, dt: number): number {
    //up velocity at the begining of the last frame (v=u+at)

    // ilya: add * 2 to speed up jump animation
    // let js: number = speed - this._gravity * this._jumpTime;
    let js: number = speed - this._gravity * this._jumpTime * 2;
    //distance travelled up since last frame to this frame (s=ut+1/2*at^2)
    let jumpDist: number = js * dt - 0.5 * this._gravity * dt * dt;
    return jumpDist;
  }

  /**
   * does cleanup at the end of a jump
   */
  protected _endJump() {
    this._act._jump = false;
    this._jumpTime = 0;
    this._wasWalking = false;
    this._wasRunning = false;
  }

  /**
   * checks if two vectors v1 and v2 are equal within a precision of p
   */
  protected _areVectorsEqual(v1: Vector3, v2: Vector3, p: number) {
    return (
      Math.abs(v1.x - v2.x) < p &&
      Math.abs(v1.y - v2.y) < p &&
      Math.abs(v1.z - v2.z) < p
    );
  }

  /*
   * returns the slope (in radians) of a vector in the vertical plane
   */
  protected _verticalSlope(v: Vector3): number {
    return Math.atan(Math.abs(v.y / Math.sqrt(v.x * v.x + v.z * v.z)));
  }

  //for how long has the av been falling while moving
  protected _movFallTime: number = 0;
  protected _sign = 1;
  protected _isTurning = false;
  protected _noRot = false;
  protected _changePriority = false;
  protected _doMove(dt: number): ActionData {
    //initial down velocity
    const u: number = this._movFallTime * this._gravity;
    //calculate the distance by which av should fall down since last frame
    //assuming it is in freefall
    this._freeFallDist = u * dt + (this._gravity * dt * dt) / 2;

    this._movFallTime = this._movFallTime + dt;

    let moving: boolean = false;
    let anim: ActionData = null;

    if (this._inFreeFall) {
      this._moveVector.y = -this._freeFallDist;
      moving = true;
    } else {
      this._wasWalking = false;
      this._wasRunning = false;

      let sign: number;
      let horizDist: number = 0;

      switch (true) {
        case this._act._stepLeft && !this._changePriority:
          sign = this._signRHS * this._isAvFacingCamera();
          horizDist = this._actionMap.strafeLeft.speed * dt;
          if (this._act._speedMod) {
            horizDist = this._actionMap.strafeLeftFast.speed * dt;
            anim =
              -this._ffSign * sign > 0
                ? this._actionMap.strafeLeftFast
                : this._actionMap.strafeRightFast;
          } else {
            anim =
              -this._ffSign * sign > 0
                ? this._actionMap.strafeLeft
                : this._actionMap.strafeRight;
          }

          this._moveVector = this._avatar.calcMovePOV(
            sign * horizDist,
            -this._freeFallDist,
            0,
          );
          moving = true;
          break;
        case this._act._stepRight:
          sign = -this._signRHS * this._isAvFacingCamera();
          horizDist = this._actionMap.strafeRight.speed * dt;
          if (this._act._speedMod) {
            horizDist = this._actionMap.strafeRightFast.speed * dt;
            anim =
              -this._ffSign * sign > 0
                ? this._actionMap.strafeLeftFast
                : this._actionMap.strafeRightFast;
          } else {
            anim =
              -this._ffSign * sign > 0
                ? this._actionMap.strafeLeft
                : this._actionMap.strafeRight;
          }
          this._moveVector = this._avatar.calcMovePOV(
            sign * horizDist,
            -this._freeFallDist,
            0,
          );
          moving = true;
          break;
        case this._act._walk || this._isRecastWalkActive || this._noRot:
          if (this._act._speedMod) {
            this._wasRunning = true;
            horizDist = this._actionMap.run.speed * dt;
            anim = this._actionMap.run;
          } else {
            this._wasWalking = true;
            horizDist = this._actionMap.walk.speed * dt;
            anim = this._actionMap.walk;
          }
          this._moveVector = this._avatar.calcMovePOV(
            0,
            -this._freeFallDist,
            this._ffSign * horizDist,
          );
          moving = true;
          break;
        case this._act._walkback:
          horizDist = this._actionMap.walkBack.speed * dt;
          if (this._act._speedMod) {
            horizDist = this._actionMap.walkBackFast.speed * dt;
            anim = this._actionMap.walkBackFast;
          } else {
            anim = this._actionMap.walkBack;
          }
          this._moveVector = this._avatar.calcMovePOV(
            0,
            -this._freeFallDist,
            -this._ffSign * horizDist,
          );
          moving = true;
          break;
      }
    }

    if (
      !this._noRot &&
      !this._act._stepLeft &&
      !this._act._stepRight &&
      (this._act._turnLeft || this._act._turnRight)
    ) {
      let turnAngle = this._actionMap.turnLeft.speed * dt;
      if (this._act._speedMod) {
        turnAngle = 2 * turnAngle;
      }
      let a = 1;
      if (this._act._turnLeft) {
        if (this._act._walkback) a = -1;
        if (!moving) anim = this._actionMap.turnLeft;
      } else {
        if (this._act._walk) a = -1;
        if (!moving) {
          a = -1;
          anim = this._actionMap.turnRight;
        }
      }
      this._camera.alpha = this._camera.alpha + turnAngle * a;
    }

    if (this._noRot) {
      switch (true) {
        case this._act._walk && this._act._turnRight:
          this._avatar.rotation.y =
            this._av2cam - this._camera.alpha + Math.PI / 4;
          break;
        case this._act._walk && this._act._turnLeft:
          this._avatar.rotation.y =
            this._av2cam - this._camera.alpha - Math.PI / 4;
          break;
        case this._act._walkback && this._act._turnRight:
          this._avatar.rotation.y =
            this._av2cam - this._camera.alpha + (3 * Math.PI) / 4;
          break;
        case this._act._walkback && this._act._turnLeft:
          this._avatar.rotation.y =
            this._av2cam - this._camera.alpha - (3 * Math.PI) / 4;
          break;
        case this._act._walk:
          this._avatar.rotation.y = this._av2cam - this._camera.alpha;
          break;
        case this._act._walkback:
          this._avatar.rotation.y = this._av2cam - this._camera.alpha + Math.PI;
          break;
        case this._act._turnRight:
          this._avatar.rotation.y =
            this._av2cam - this._camera.alpha + Math.PI / 2;
          break;
        case this._act._turnLeft:
          this._avatar.rotation.y =
            this._av2cam - this._camera.alpha - Math.PI / 2;
          break;
      }
    } else {
      this._avatar.rotation.y = this._av2cam - this._camera.alpha;
    }
    if (moving) {
      const moveLength = this._moveVector.length();
      if (moveLength > 0.001) {
        if (this._moveFrameCount > this._moveFrameCountMin) {
          this._avatar.moveWithCollisions(this._moveVector);
        } else {
          this._moveFrameCount++;
        }

        // inc walked distance
        if (
          this._isRecastWalkActive &&
          this._moveFrameCount > this._moveFrameCountMin
        ) {
          this._distanceWalked += moveLength;
        }
        //walking up a slope
        if (this._avatar.position.y > this._avStartPos.y) {
          const actDisp: Vector3 = this._avatar.position.subtract(
            this._avStartPos,
          );
          const _slp: number = this._verticalSlope(actDisp);
          if (_slp >= this._sl2) {
            //this._climbingSteps=true;
            //is av trying to go up steps
            if (this._stepOffset > 0) {
              if (this._vMoveTot == 0) {
                //if just started climbing note down the position
                this._vMovStartPos.copyFrom(this._avStartPos);
              }
              this._vMoveTot =
                this._vMoveTot + (this._avatar.position.y - this._avStartPos.y);
              if (this._vMoveTot > this._stepOffset) {
                //move av back to its position at begining of steps
                this._vMoveTot = 0;
                this._avatar.position.copyFrom(this._vMovStartPos);
                this._endFreeFall();
              }
            } else {
              //move av back to old position
              this._avatar.position.copyFrom(this._avStartPos);
              this._endFreeFall();
            }
          } else {
            this._vMoveTot = 0;
            if (_slp > this._sl1) {
              //av is on a steep slope , continue increasing the moveFallTIme to deaccelerate it
              this._fallFrameCount = 0;
              this._inFreeFall = false;
            } else {
              //continue walking
              this._endFreeFall();
            }
          }
        } else if (this._avatar.position.y < this._avStartPos.y) {
          const actDisp: Vector3 = this._avatar.position.subtract(
            this._avStartPos,
          );
          if (!this._areVectorsEqual(actDisp, this._moveVector, 0.001)) {
            //AV is on slope
            //Should AV continue to slide or walk?
            //if slope is less steeper than acceptable then walk else slide
            if (this._verticalSlope(actDisp) <= this._sl1) {
              this._endFreeFall();
            } else {
              //av is on a steep slope , continue increasing the moveFallTIme to deaccelerate it
              this._fallFrameCount = 0;
              this._inFreeFall = false;
            }
          } else {
            this._inFreeFall = true;
            this._fallFrameCount++;
            //AV could be running down a slope which mean freefall,run,frefall run ...
            //to remove anim flicker, check if AV has been falling down continously for last few consecutive frames
            //before changing to free fall animation
            if (this._fallFrameCount > this._fallFrameCountMin) {
              console.log("avatar in free fall");
              // anim = this._actionMap.fall;

              //temp use ide for fall animation
              anim = this._actionMap.idle;
            }
          }
        } else {
          this._endFreeFall();
        }
      }
    }
    return anim;
  }

  protected _endFreeFall(): void {
    this._movFallTime = 0;
    this._fallFrameCount = 0;
    this._inFreeFall = false;
  }

  //for how long has the av been falling while idle (not moving)
  protected _idleFallTime: number = 0;
  protected _doIdle(dt: number): ActionData {
    if (this._grounded) {
      return this._actionMap.idle;
    }
    this._wasWalking = false;
    this._wasRunning = false;
    this._movFallTime = 0;
    this._moveFrameCount = 0;
    let anim: ActionData = this._actionMap.idle;
    this._fallFrameCount = 0;

    if (dt === 0) {
      this._freeFallDist = 5;
    } else {
      const u: number = this._idleFallTime * this._gravity;
      this._freeFallDist = u * dt + (this._gravity * dt * dt) / 2;
      this._idleFallTime = this._idleFallTime + dt;
    }
    //if displacement is less than 0.01(? need to verify further) then
    //moveWithDisplacement down against a surface seems to push the AV up by a small amount!!
    if (this._freeFallDist < 0.01) return anim;
    const disp: Vector3 = new Vector3(0, -this._freeFallDist, 0);
    if (!this._noRot)
      this._avatar.rotation.y = this._av2cam - this._camera.alpha;
    this._avatar.moveWithCollisions(disp);
    if (
      this._avatar.position.y > this._avStartPos.y ||
      this._avatar.position.y === this._avStartPos.y
    ) {
      //                this.grounded = true;
      //                this.idleFallTime = 0;
      this._groundIt();
    } else if (this._avatar.position.y < this._avStartPos.y) {
      //AV is going down.
      //AV is either in free fall or is sliding along a downward slope
      //
      //if the actual displacemnt is same as the desired displacement then AV is in freefall
      //else it is on a slope
      const actDisp: Vector3 = this._avatar.position.subtract(this._avStartPos);
      if (!this._areVectorsEqual(actDisp, disp, 0.001)) {
        //AV is on slope
        //Should AV continue to slide or stop?
        //if slope is less steeper than accebtable then stop else slide
        if (this._verticalSlope(actDisp) <= this._sl1) {
          //                        this.grounded = true;
          //                        this.idleFallTime = 0;
          this._groundIt();
          this._avatar.position.copyFrom(this._avStartPos);
        } else {
          this._unGroundIt();
          anim = this._actionMap.slideBack;
        }
      }
    }
    return anim;
  }

  protected _groundFrameCount = 0;
  protected _groundFrameMax = 10;
  /**
   * donot ground immediately
   * wait few more frames
   */
  protected _groundIt(): void {
    this._groundFrameCount++;
    if (this._groundFrameCount > this._groundFrameMax) {
      this._grounded = true;
      this._idleFallTime = 0;
    }
  }
  protected _unGroundIt() {
    this._grounded = false;
    this._groundFrameCount = 0;
  }

  protected _savedCameraCollision: boolean = true;
  protected _inFP = false;
  protected _updateTargetValue() {
    //donot move camera if av is trying to clinb steps
    if (this._vMoveTot == 0)
      this._avatar.position.addToRef(this._cameraTarget, this._camera.target);

    if (this._camera.radius > this._camera.lowerRadiusLimit) {
      if (this._cameraElastic || this._makeInvisible) this._handleObstruction();
    }

    if (this._camera.radius <= this._camera.lowerRadiusLimit) {
      if (!this._noFirstPerson && !this._inFP) {
        this._makeMeshInvisible(this._avatar);
        this._camera.checkCollisions = false;
        this._inFP = true;
        this._avatar.setEnabled(false);
      }
    } else {
      if (this._inFP) {
        this._inFP = false;
        this._restoreVisiblity(this._avatar);
        this._camera.checkCollisions = this._savedCameraCollision;
      }
    }
  }

  // make mesh and all its children invisible
  // store their current visibility state so that we can restore them later on
  private _makeMeshInvisible(mesh: Mesh) {
    console.log("make mesh invisible", mesh);
    this._visiblityMap.set(mesh, mesh.visibility);
    mesh.visibility = 0;

    mesh.getChildMeshes(false, (n) => {
      if (n instanceof Mesh) {
        this._visiblityMap.set(n, n.visibility);
        n.visibility = 0;
      }
      return false;
    });
  }

  private _visiblityMap: Map<Mesh, int> = new Map();

  //restore mesh visibility to previous state
  private _restoreVisiblity(mesh: Mesh) {
    mesh.visibility = this._visiblityMap.get(mesh);
    mesh.getChildMeshes(false, (n) => {
      if (n instanceof Mesh) n.visibility = this._visiblityMap.get(n);
      return false;
    });
  }

  protected _publishPlayerState() {
    const sign = this._signRHS * this._isAvFacingCamera();
    const playerState = {
      position: {
        x: this._avatar.position._x,
        y: this._avatar.position._y,
        z: this._avatar.position._z,
      },
      rotationY: this._avatar.rotation._y,
      actions: {
        walk: this._act._walk || this._isRecastWalkActive,
        walkback: this._act._walkback,
        turnRight: this._act._turnRight,
        turnLeft: this._act._turnLeft,
        stepRight:
          this._ffSign * sign > 0 ? this._act._stepLeft : this._act._stepRight,
        stepLeft:
          -this._ffSign * sign > 0 ? this._act._stepLeft : this._act._stepRight,
        jump: this._act._jump,
        victory: this._act._victory,
        hello: this._act._hello,
        dismiss: this._act._dismiss,
        clapping: this._act._clapping,
        dance: this._act._dance,
        speedMod: this._act._speedMod,
        changePriority: this._changePriority,
      },
      emoji: { emoji: this.emojiText },
    };

    // publish player state to websocket
    const publish = () => {
      this._networkSystem.publishPlayerState(playerState);
    };

    publish();
  }

  protected _ray: Ray = new Ray(Vector3.Zero(), Vector3.One(), 1);
  protected _rayDir: Vector3 = Vector3.Zero();
  //camera seems to get stuck into things
  //should move camera away from things by a value of cameraSkin
  protected _cameraSkin: number = 0.5;
  protected _prevPickedMeshes: AbstractMesh[];
  protected _pickedMeshes: AbstractMesh[] = new Array();
  protected _makeInvisible = false;
  protected _elasticSteps = 50;
  protected _alreadyInvisible: AbstractMesh[];

  /**
   * The following method handles the use case wherein some mesh
   * comes between the avatar and the camera thus obstructing the view
   * of the avatar.
   * Two ways this can be handled
   * a) make the obstructing  mesh invisible
   *   instead of invisible a better option would have been to make semi transparent.
   *   Unfortunately, unlike mesh, mesh instances do not "visibility" setting)
   *   Every alternate frame make mesh visible and invisible to give the impression of semi-transparent.
   * b) move the camera in front of the obstructing mesh
   */
  private _handleObstruction() {
    //get vector from av (camera.target) to camera
    this._camera.position.subtractToRef(this._camera.target, this._rayDir);
    //start ray from av to camera
    this._ray.origin = this._camera.target;
    this._ray.length = this._rayDir.length();
    this._ray.direction = this._rayDir.normalize();

    const pis: PickingInfo[] = this._scene.multiPickWithRay(
      this._ray,
      (mesh) => {
        // skip avatar and smart items
        if (
          mesh == this._avatar ||
          mesh.parent == this._avatar ||
          mesh.parent?.parent == this._avatar ||
          mesh.metadata?.data?.type?.includes("smart-item") ||
          mesh.parent?.metadata?.data?.type?.includes("smart-item") ||
          mesh.parent?.parent?.metadata?.data?.type?.includes("smart-item")
        )
          return false;
        else return true;
      },
    );

    if (this._makeInvisible) {
      this._prevPickedMeshes = this._pickedMeshes;
      if (pis.length > 0) {
        this._pickedMeshes = new Array();
        for (let pi of pis) {
          if (
            pi.pickedMesh.isVisible ||
            this._prevPickedMeshes.includes(pi.pickedMesh)
          ) {
            pi.pickedMesh.isVisible = false;
            this._pickedMeshes.push(pi.pickedMesh);
          }
        }
        for (let pm of this._prevPickedMeshes) {
          if (!this._pickedMeshes.includes(pm)) {
            pm.isVisible = true;
          }
        }
      } else {
        for (let pm of this._prevPickedMeshes) {
          pm.isVisible = true;
        }
        this._prevPickedMeshes.length = 0;
      }
    }

    if (this._cameraElastic) {
      if (pis.length > 0) {
        // postion the camera in front of the mesh that is obstructing camera

        //if only one obstruction and it is invisible then if it is not collidable or our camera is not collidable then do nothing
        if (
          pis.length == 1 &&
          !this._isSeeAble(pis[0].pickedMesh) &&
          (!pis[0].pickedMesh.checkCollisions || !this._camera.checkCollisions)
        )
          return;

        //if our camera is collidable then we donot want it to get stuck behind another collidable obsrtucting mesh
        let pp: Vector3 = null;

        //we will asume the order of picked meshes is from closest to avatar to furthest
        //we should get the first one which is visible or invisible and collidable
        for (let i = 0; i < pis.length; i++) {
          let pm = pis[i].pickedMesh;
          if (this._isSeeAble(pm)) {
            pp = pis[i].pickedPoint;
            break;
          } else if (pm.checkCollisions) {
            pp = pis[i].pickedPoint;
            break;
          }
        }
        if (pp == null) return;

        const c2p: Vector3 = this._camera.position.subtract(pp);
        //note that when camera is collidable, changing the orbital camera radius may not work.
        //changing the radius moves the camera forward (with collision?) and collision can interfere with movement
        //
        //in every cylce we are dividing the distance to tarvel by same number of steps.
        //as we get closer to destination the speed will thus slow down.
        //when just 1 unit distance left, lets snap to the final position.
        //when calculating final position make sure the camera does not get stuck at the pickposition especially
        //if collision is on

        const l: number = c2p.length();
        if (this._camera.checkCollisions) {
          let step: Vector3;
          if (l <= 1) {
            step = c2p.addInPlace(
              c2p.normalizeToNew().scaleInPlace(this._cameraSkin),
            );
          } else {
            step = c2p.normalize().scaleInPlace(l / this._elasticSteps);
          }
          this._camera.position = this._camera.position.subtract(step);
        } else {
          let step: number;
          if (l <= 1) step = l + this._cameraSkin;
          else step = l / this._elasticSteps;
          this._camera.radius = this._camera.radius - step;
        }
      }
    }
  }

  //how many ways can a mesh be invisible?
  private _isSeeAble(mesh: AbstractMesh): boolean {
    if (!mesh.isVisible) return false;
    if (mesh.visibility == 0) return false;
    if (
      mesh.material != null &&
      mesh.material.alphaMode != 0 &&
      mesh.material.alpha == 0
    )
      return false;
    return true;
    //what about vertex color? groan!
  }

  public anyMovement(): boolean {
    return (
      this._act._walk ||
      this._act._walkback ||
      this._act._turnLeft ||
      this._act._turnRight ||
      this._act._stepLeft ||
      this._act._stepRight ||
      this._act._jump
    );
  }

  public anyAction(): boolean {
    return (
      this._act._clapping ||
      this._act._dance ||
      this._act._hello ||
      this._act._victory ||
      this._act._dismiss
    );
  }

  public onXpGained() {
    this._act.reset();
    this._act._victory = true;
    const anim = this._scene.animationGroups.find((ag) =>
      ag.name.includes(this._actionMap.victory.name),
    );

    anim.play();
    setTimeout(
      () => {
        this._act._victory = false;
      },
      (anim.to - anim.from) * 15,
    );
  }

  public stopMoving() {
    this._scene.animationGroups.find((ag) => ag.name === "idlemain").play();
  }

  public playAnimations(anim: string) {
    this.stopCustomAnimations();
    this._act[`_${anim}`] = true;

    const animation = this._scene.animationGroups
      .find((ag) => ag.name.includes(this._actionMap?.[anim]?.name))
      ?.play();
    this.animationTimeout = setTimeout(
      () => {
        this.stopCustomAnimations();
      },
      (animation.to - animation.from) * 10,
    );
  }

  public stopCustomAnimations() {
    if (this.animationTimeout) clearTimeout(this.animationTimeout);
    this._scene.animationGroups.forEach((ag) => {
      if (!ag.name.includes("main")) return;
      if (
        castomAnimaArr.some((name) => ag.name.includes(name)) &&
        ag.isPlaying
      ) {
        ag.setWeightForAllAnimatables(ag.to);
        ag.stop();
        this._act[`_${ag.name.replace("main", "")}`] = false;
      }
    });
  }

  public showEmoji(emoji: string) {
    // destroy lates emoji
    if (this.emoji) {
      this.emoji.dispose();
      this.emoji = null;
      this.emojiText = "";
    }
    // destroy timeout if it exist
    if (this.emojiTimeout) {
      clearTimeout(this.emojiTimeout);
      this.emojiTimeout = null;
    }
    // save emoji for send to network
    this.emojiText = emoji;
    // create mesh for view
    const emojiMesh = this.createTextMesh(emoji, 48, 0.3, 0.145);
    // save for destroy it then
    this.emoji = emojiMesh;

    // create timeout for destroy emoji after 5 sec
    this.emojiTimeout = setTimeout(() => {
      if (this.emoji) {
        this.emoji.dispose();
        this.emoji = null;
        this.emojiText = "";
      }
    }, 5000);
  }

  protected _onKeyDown(e: KeyboardEvent) {
    if (!e.code) return;
    if (e.repeat) return;
    this._changePriority = false;

    // stop recast movement on keybord click
    const code = e.code.toLowerCase();
    if (
      code !== "shift" &&
      code !== "shiftleft" &&
      code !== "shiftright" &&
      this.pointerMesh
    ) {
      this._isRecastWalkActive = false;
      this.pointerMesh.setEnabled(false);
      this.stopCustomAnimations();
    }

    switch (code) {
      case this._actionMap.idleJump.key:
      case "space":
        this._act._jump = true;
        break;
      case "capslock":
        this._act._speedMod = !this._act._speedMod;
        break;
      case "shift":
      case "shiftleft":
      case "shiftright":
        this._act._speedMod = true;
        break;
      case "up":
      case "keyw":
      case "arrowup":
      case this._actionMap.walk.key:
        this._act._walk = true;
        break;
      case "left":
      case "keya":
      case "arrowleft":
      case this._actionMap.turnLeft.key:
        this._act._turnLeft = true;
        break;
      case "right":
      case "keyd":
      case "arrowright":
      case this._actionMap.turnRight.key:
        this._act._turnRight = true;
        break;
      case "down":
      case "keys":
      case "arrowdown":
      case this._actionMap.walkBack.key:
        this._act._walkback = true;
        break;
      case "keyq":
      case this._actionMap.strafeLeft.key:
        this._act._stepLeft = true;
        break;
      case "keye":
      case this._actionMap.strafeRight.key:
        this._act._stepRight = true;
        this._changePriority = true;
        break;
    }
  }

  protected _onKeyUp(e: KeyboardEvent) {
    if (!e.code) {
      return;
    }
    switch (e.code.toLowerCase()) {
      case "shift":
      case "shiftleft":
      case "shiftright":
        this._act._speedMod = false;
        break;
      case "up":
      case "keyw":
      case "arrowup":
      case this._actionMap.walk.key:
        this._act._walk = false;
        break;
      case "left":
      case "keya":
      case "arrowleft":
      case this._actionMap.turnLeft.key:
        this._act._turnLeft = false;
        this._isTurning = false;
        break;
      case "right":
      case "keyd":
      case "arrowright":
      case this._actionMap.turnRight.key:
        this._act._turnRight = false;
        this._isTurning = false;
        break;
      case "down":
      case "keys":
      case "arrowdown":
      case this._actionMap.walkBack.key:
        this._act._walkback = false;
        break;
      case this._actionMap.strafeLeft.key:
      case "keyq":
        this._act._stepLeft = false;
        break;
      case "keye":
      case this._actionMap.strafeRight.key:
        this._act._stepRight = false;
        this._changePriority = false;
        break;
    }
  }

  protected _ekb: boolean;
  public enableKeyBoard(b: boolean) {
    this._ekb = b;
    let canvas: HTMLCanvasElement = this._scene
      .getEngine()
      .getRenderingCanvas();

    if (!canvas) return;
    if (b) {
      canvas.addEventListener("keyup", this._handleKeyUp, false);
      canvas.addEventListener("keydown", this._handleKeyDown, false);
    } else {
      canvas.removeEventListener("keyup", this._handleKeyUp, false);
      canvas.removeEventListener("keydown", this._handleKeyDown, false);
    }
  }
  // control movement by commands rather than keyboard.
  public walk(b: boolean) {
    this._act._walk = b;
  }

  protected _act: _Action;
  protected _renderer: () => void;
  protected _handleKeyUp: (e) => void;
  protected _handleKeyDown: (e) => void;
  protected _isAG: boolean = false;
  public isAg() {
    return this._isAG;
  }

  protected _findSkel(n: Node): Skeleton {
    let root = this._root(n);

    if (root instanceof Mesh && root.skeleton) return root.skeleton;

    //find all child meshes which have skeletons
    let ms = root.getChildMeshes(false, (cm) => {
      if (cm instanceof Mesh) {
        if (cm.skeleton) {
          return true;
        }
      }
      return false;
    });

    //return the skeleton of the first child mesh
    if (ms.length > 0) return ms[0].skeleton;
    else return null;
  }

  protected _root(tn: Node): Node {
    if (tn.parent == null) return tn;
    return this._root(tn.parent);
  }

  public setAvatar(avatar: Mesh, faceForward: boolean = false): boolean {
    let rootNode = this._root(avatar);
    if (rootNode instanceof Mesh) {
      this._avatar = rootNode;
    } else {
      console.error(
        "Cannot move this mesh. The root node of the mesh provided is not a mesh",
      );
      return false;
    }

    this._skeleton = this._findSkel(avatar);
    this._isAG = this._containsAG(avatar, this._scene.animationGroups, true);

    this._actionMap.reset();

    this._setRHS(avatar);
    this.setFaceForward(faceForward);

    return true;
  }

  private isChangingAvatar = false;
  public avatarCollider: Mesh;
  public async replaceAvatar(
    avatarUrl: string,
    gender: string,
    nickname?: string,
    generateNavMesh?: boolean,
  ) {
    if (this.isChangingAvatar) return;
    this.isChangingAvatar = true;
    // stop avatar movement/animation
    this.stop();
    // load new avatar asset
    const isDefaultAvatar = avatarUrl.indexOf("default_avatar") > -1;
    const { meshes, skeletons } = await SceneLoader.ImportMeshAsync(
      "",
      isDefaultAvatar ? "/assets/avatars/" : "",
      isDefaultAvatar
        ? avatarUrl.split("/").pop()
        : `${
            avatarUrl.indexOf("?") > -1 ? `${avatarUrl}&` : `${avatarUrl}?`
          }morphTargets=Default&textureAtlas=none&textureSizeLimit=512&useDracoMeshCompression=true`,
    );

    meshes[0].setEnabled(false);

    // to do: use gltfpack for rpm avatars
    // best quality:  `${link}?morphTargets=Default&textureAtlas=none&textureSizeLimit=1024`
    // best perfomance:  `${link}?morphTargets=Default&textureAtlas=1024&textureSizeLimit=1024`

    // shadow
    SceneService.shadowGenerator.addShadowCaster(meshes[0]);

    // assign skeleton
    const skeleton = skeletons[0];
    let player = meshes[0] as Mesh;
    player.skeleton = skeleton;
    player.id = "player";
    player.name = "player";

    // change default glb rotation
    player.rotation = player.rotationQuaternion.toEulerAngles();
    player.rotationQuaternion = null;

    // copy current avatar mesh props
    player.position = this._avatar.position;
    player.rotation = this._avatar.rotation;
    player.checkCollisions = this._avatar.checkCollisions;
    player.ellipsoid = this._avatar.ellipsoid;
    player.ellipsoidOffset = this._avatar.ellipsoidOffset;
    player.isPickable = this._avatar.isPickable;

    // change camera angle
    this._camera.alpha = this._av2cam - this._avatar.rotation.y;

    // remove old mesh and skeleton
    this._avatar?.dispose();
    this._skeleton?.dispose();
    this._animatedAvatarMeshes.forEach((x) => x.dispose());
    this._animatedAvatarMeshes = [];

    // create collder mesh
    if (!this.avatarCollider) {
      this.avatarCollider = MeshBuilder.CreateBox("AvatarCollider", {
        height: 2.1,
      });
      this.avatarCollider.position.y = 1;
      this.avatarCollider.visibility = 0;
    }

    // set new avatar mesh
    let rootNode = this._root(player);
    if (rootNode instanceof Mesh) {
      this._avatar = rootNode;

      // attach collider to avtar
      this.avatarCollider.parent = this._avatar;
    } else {
      console.error(
        "Cannot move this mesh. The root node of the mesh provided is not a mesh",
      );
      return false;
    }

    // set new skeleton
    this._skeleton = this._findSkel(player);
    const agMap = AvatarService.getAnimationGroupsByGender(
      gender,
      this._scene.animationGroups,
      "main",
    );

    this.setAnimationGroups(agMap);

    // retargeting animation groups
    const bonesDict = R.indexBy(R.prop("name"), this._skeleton.bones);
    this._scene.animationGroups.forEach((ag) => {
      if (ag.name.includes("main")) {
        // stop animation group
        ag.stop();
        // retargeting
        ag.targetedAnimations.forEach((targetedAnimation) => {
          const newTargetBone = bonesDict[targetedAnimation.target.name];
          if (newTargetBone) {
            targetedAnimation.target = newTargetBone.getTransformNode();
          }
        });
      }
    });

    this._setRHS(player);

    // enable mesh
    this._avatar.setEnabled(true);

    // blend animation
    this.enableBlending(0.1);

    // start user avatar update loop
    this.start();

    if (nickname) {
      this.setNicknameBillboard(nickname);
    }

    // build recast nav mesh
    if (generateNavMesh) {
      this.setNavMesh();
    }

    // activate camera
    this._scene.activeCamera = this._camera;
    this._camera.attachControl();

    // set audio listener position
    this._scene.audioListenerPositionProvider = () => {
      return this._avatar.absolutePosition;
    };

    this._scene.audioPositioningRefreshRate = 100;

    this.isChangingAvatar = false;
  }

  public disposeAvatar() {
    this.enableKeyBoard(false);
    this.stop();
    this._avatar?.dispose();
    this._skeleton?.dispose();
    this._animatedAvatarMeshes.forEach((x) => x.dispose());
    this._animatedAvatarMeshes = [];
  }

  public isEditMode = false;
  public hideAvatar() {
    this._avatar.setEnabled(false);
    this.enableKeyBoard(false);
    this._camera.detachControl();
    this.stop();
    this.isEditMode = true;
  }

  public showAvatar() {
    this._avatar.setEnabled(true);
    this.isEditMode = false;
    this.enableKeyBoard(true);
    this.start();
    this._scene.activeCamera = this._camera;
    this._camera.attachControl();
  }

  // does this character have any animations ?
  // remember we can use meshes without anims as characters too
  protected _hasAnims: boolean = false;
  protected _animatedAvatarMeshes: Mesh[] = [];

  private _framesAfterLastAction = 0;
  private _maxFramesSinceLastAction = 37;

  /**
   * The avatar/character can be made up of multiple meshes arranged in a hierarchy.
   * As such we will pick the root of the hierarchy as the avatar.
   * The root should be a mesh as otherwise we cannot move it with moveWithCollision() method.
   *
   * Mutiple meshes in the hierarchy may have skeletons (if two or more meshes have skeleton then
   * the skeleton will mostly likely be the same).
   * So we will pick as avatar skeleton, the  skeleton of the first mesh in the hierachy which has
   * a skeleton
   *
   * @param avatar
   * @param camera
   * @param scene
   * @param actionMap/animationGroupMap
   *        maps actions to animations and other data like speed,sound etc
   *        or
   *        for backward compatibility could be AnimationGroup Map
   * @param faceForward
   */
  constructor(
    networkSystem: ColyseusNetwork,
    avatar: Mesh,
    meshes: Mesh[],
    camera: ArcRotateCamera,
    scene: Scene,
    actionMap?: {},
    faceForward = false,
    spawnPointData?: SmartItemVM,
  ) {
    if (!camera) {
      console.error("unable to set avatar -> ArcRotateCamera is not provided");
      return;
    }

    this._networkSystem = networkSystem;
    this._camera = camera;
    this._scene = scene;
    this._animatedAvatarMeshes = meshes;

    let success = this.setAvatar(avatar, faceForward);
    if (!success) {
      console.error("unable to set avatar");
    }

    let dataType: string = null;
    if (actionMap != null) {
      dataType = this.setActionMap(<ActionMap>actionMap);
    }

    this._savedCameraCollision = this._camera.checkCollisions;

    // set avatar turning  mode
    this.setTurningOff(true);

    //below makes the controller point the camera at the player head which is approx
    //1.5m above the player origin
    this.setCameraTarget(new Vector3(0, 1.5, 0));

    // disable player camera autofocus
    this.setCameraElasticity(false);

    // blend animation
    this.enableBlending(0.1);

    //if the camera comes close to the player we want to enter first person mode.
    this.setNoFirstPerson(true);
    //the height of steps which the player can climb
    this.setStepOffset(0.45);
    //the minimum and maximum slope the player can go up
    //between the two the player will start sliding down if it stops
    this.setSlopeLimit(45, 90);

    this.setWalkSpeed(2.5);
    this.setRunSpeed(4.5);
    this._act = new _Action();

    this._renderer = () => {
      this._moveAVandCamera();
      if (this.anyMovement() || this.anyAction()) {
        this._framesAfterLastAction = 0;
        this._publishPlayerState();
      } else if (
        this._framesAfterLastAction <= this._maxFramesSinceLastAction
      ) {
        this._framesAfterLastAction += 1;
        this._publishPlayerState();
      }

      // reset avatar position if he falls down
      if (this._avatar.position.y < -80) {
        if (spawnPointData) {
          this._avatar.position = new Vector3(
            spawnPointData.data.transform.position.x,
            spawnPointData.data.transform.position.y,
            spawnPointData.data.transform.position.z,
          );
        } else {
          this._avatar.position = new Vector3(0, 0, 0);
        }
      }
    };
    this._handleKeyUp = (e) => {
      this._onKeyUp(e);
    };
    this._handleKeyDown = (e) => {
      this._onKeyDown(e);
    };
  }
}

export class _Action {
  public _walk: boolean = false;
  public _walkback: boolean = false;
  public _turnRight: boolean = false;
  public _turnLeft: boolean = false;
  public _stepRight: boolean = false;
  public _stepLeft: boolean = false;
  public _jump: boolean = false;
  public _victory: boolean = false;
  public _hello: boolean = false;
  public _dismiss: boolean = false;
  public _clapping: boolean = false;
  public _dance: boolean = false;
  public _changePriority: boolean = false;

  // speed modifier - changes speed of movement
  public _speedMod: boolean = false;

  constructor() {
    this.reset();
  }

  reset() {
    this._walk = false;
    this._walkback = false;
    this._turnRight = false;
    this._turnLeft = false;
    this._stepRight = false;
    this._stepLeft = false;
    this._jump = false;
    this._victory = false;
    this._hello = false;
    this._dismiss = false;
    this._speedMod = false;
    this._clapping = false;
    this._dance = false;
    this._changePriority = false;
  }
}

export class ActionData {
  public id: string;
  public speed: number;
  //_ds default speed.  speed is set to this on reset
  public ds: number;
  public sound: string;
  public key: string;
  //_dk defailt key
  public dk: string;

  //animation data
  //if _ag is null then assuming animation range and use _name to play animationrange
  public name: string = "";
  public ag: AnimationGroup;
  public loop: boolean = true;
  public rate: number = 1;

  public exist: boolean = false;

  public constructor(id?: string, speed = 1, key?: string) {
    this.id = id;
    this.speed = speed;
    this.ds = speed;
    this.key = key;
    this.dk = key;
  }

  public reset() {
    this.name = "";
    this.speed = this.ds;
    this.key = this.dk;
    this.loop = true;
    this.rate = 1;
    this.sound = "";
    this.exist = false;
  }
}

//not really a "Map"
export class ActionMap {
  public walk = new ActionData("walk", 3, "w");
  public walkBack = new ActionData("walkBack", 1.5, "s");
  public walkBackFast = new ActionData("walkBackFast", 3, "na");
  public idle = new ActionData("idle", 0, "na");
  public idleJump = new ActionData("idleJump", 6, " ");
  public run = new ActionData("run", 6, "na");
  public runJump = new ActionData("runJump", 6, "na");
  public victory = new ActionData("victory", 1, "z");
  public hello = new ActionData("hello", 1, "na");
  public dismiss = new ActionData("dismiss", 1, "na");
  public dance = new ActionData("dance", 1, "na");
  public clapping = new ActionData("clapping", 1, "na");
  public fall = new ActionData("fall", 0, "na");
  public turnLeft = new ActionData("turnLeft", Math.PI / 8, "a");
  public turnLeftFast = new ActionData("turnLeftFast", Math.PI / 4, "na");
  public turnRight = new ActionData("turnRight", Math.PI / 8, "d");
  public turnRightFast = new ActionData("turnRightFast", Math.PI / 4, "na");
  public strafeLeft = new ActionData("strafeLeft", 1.5, "q");
  public strafeLeftFast = new ActionData("strafeLeftFast", 3, "na");
  public strafeRight = new ActionData("strafeRight", 1.5, "e");
  public strafeRightFast = new ActionData("strafeRightFast", 3, "na");
  public slideBack = new ActionData("slideBack", 0, "na");

  public reset() {
    let keys: string[] = Object.keys(this);
    for (let key of keys) {
      let act = this[key];
      if (!(act instanceof ActionData)) continue;
      act.reset();
    }
  }
}

export class CCSettings {
  public faceForward: boolean;
  public gravity: number;
  public minSlopeLimit: number;
  public maxSlopeLimit: number;
  public stepOffset: number;
  public cameraElastic: boolean = true;
  public elasticSteps: number;
  public makeInvisble: boolean = true;
  public cameraTarget: Vector3 = Vector3.Zero();
  public noFirstPerson: boolean = false;
  public topDown: boolean = true;
  //turningOff takes effect only when topDown is false
  public turningOff: boolean = true;
  public keyboard: boolean = true;
}

export interface RecastAgent {
  idx: number;
  trf: TransformNode;
  mesh: Mesh;
  // target: Mesh;
}
export const castomAnimaArr = [
  "dance",
  "victory",
  "dismiss",
  "clapping",
  "hello",
];
