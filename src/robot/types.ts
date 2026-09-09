/** URDF 解析产物与运动树数据结构。 */

/** 三元组（xyz 或 rpy） */
export type Vec3 = [number, number, number];

/** 关节类型（第一版只支持 URDF 四类定义，连续/回转按 revolute 驱动） */
export type JointKind = "revolute" | "continuous" | "prismatic" | "fixed";

/** 关节描述（URDF <joint> 摘取的运动学信息） */
export interface JointDef {
  name: string;
  kind: JointKind;
  /** 父 link 名 */
  parent: string;
  /** 子 link 名 */
  child: string;
  /** 关节原点相对父 link 坐标系（米） */
  originXyz: Vec3;
  originRpy: Vec3;
  /** 旋转/移动轴，单位向量 */
  axis: Vec3;
  /** 限位（弧度，revolute/prismatic；无 <limit> 时为 ±Infinity） */
  lower: number;
  upper: number;
}

/** 视觉网格描述（URDF <visual>） */
export interface VisualDef {
  /** STL 文件名（相对机器人模型目录） */
  meshFile: string | null;
  /** URDF 材质名（可被 showModel 层覆盖） */
  materialName: string | null;
  originXyz: Vec3;
  originRpy: Vec3;
}

/** link 描述 */
export interface LinkDef {
  name: string;
  visuals: VisualDef[];
}

/** 解析后的机器人描述（与渲染/仿真解耦的静态数据） */
export interface RobotDef {
  name: string;
  links: LinkDef[];
  /** 保持 URDF 声明顺序（J1..JN 编号依据） */
  joints: JointDef[];
  /** 材质名 → 颜色（css hex） */
  materials: Record<string, string>;
}

/** 可动关节（fixed 之外），按 URDF 声明顺序编号 */
export interface ActiveJoint {
  /** 在 def.joints 中的序号，也是 J 编号来源 */
  index: number;
  def: JointDef;
  /** 关节代号，如 J1 */
  code: string;
  /** 中文名 */
  name: string;
  /** 限位（°） */
  minDeg: number;
  maxDeg: number;
}

/** 运行时机器人模型：运动树 + 可动关节表 */
export interface RobotModel {
  def: RobotDef;
  active: ActiveJoint[];
  /** 每个 link 的入向关节（root link 为 null） */
  jointOfLink: Map<string, JointDef | null>;
  /** 可动关节在 def.joints 中的序号 → 面板顺序下标 */
  activeIndexByJoint: Map<number, number>;
  /** 末端 link（TCP 依据，取运动链最深处） */
  eeLink: string;
}