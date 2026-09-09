/**
 * core —— V2 数字孪生数据底座：
 *  - frames：坐标框架树（TF 语义），统一 station/cad/robot → world
 *  - world：Pose/Twist 数学、WorldState 五域结构、freshness 分级
 * 渲染层只允许消费 world 帧数据，业务层禁止散落坐标变量。
 */
export * from "./frames";
export * from "./world";