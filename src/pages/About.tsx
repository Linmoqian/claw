function About() {
  return (
    <div className="stage">
      <section>
        <div className="section-label">
          <span className="section-label__title">关于</span>
        </div>
        <div className="about-card">
          <h1 className="about-card__title">Embodied Intelligence Console</h1>
          <p className="about-card__lead">
            为具身智能体设计的桌面控制台。连接物理机械臂，融合视觉感知、
            运动控制与 PID 调参，让智能真正“抵达”现实世界。
          </p>
          <p className="about-card__tech">
            使用 Tauri 2 + React 19 + TypeScript + Vite 构建。
          </p>
        </div>
      </section>
    </div>
  );
}

export default About;
