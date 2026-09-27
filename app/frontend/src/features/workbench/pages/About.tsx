function About() {
  return (
    <div className="stage">
      <section>
        <div className="section-label">
          <span className="section-label__title">关于</span>
        </div>
        <div className="about-card">
          <h1 className="about-card__title">虾烤工作台</h1>
          <p className="about-card__lead">
            面向不同机械臂的桌面仿真与调参工作台。以机器人模型、能力描述与
            通信适配器连接数字孪生和真实设备，让参数先在仿真中被验证。
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
