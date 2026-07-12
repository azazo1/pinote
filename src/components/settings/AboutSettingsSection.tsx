import type { AppInfo } from "../../types";

export function AboutSettingsSection({ info }: { info: AppInfo }) {
  return (
    <div className="settings-section-body">
      <header className="settings-section-heading">
        <h1>关于</h1>
        <p>Pinote 桌面便签</p>
      </header>

      <section className="settings-group about-product" aria-labelledby="about-product-heading">
        <div className="about-product-mark" aria-hidden="true">P</div>
        <div>
          <h2 id="about-product-heading">{info.name}</h2>
          <p>版本 {info.version}</p>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="about-runtime-heading">
        <h2 id="about-runtime-heading">运行环境</h2>
        <dl className="about-details">
          <div><dt>Electron</dt><dd>{info.electronVersion}</dd></div>
          <div><dt>系统</dt><dd>{info.platform}</dd></div>
          <div><dt>架构</dt><dd>{info.arch}</dd></div>
        </dl>
      </section>

      <section className="settings-group" aria-labelledby="about-data-heading">
        <h2 id="about-data-heading">数据</h2>
        <p className="settings-paragraph">便签优先保存在当前设备. 只有启用云同步后, 便签内容才会发送到配置的同步服务.</p>
      </section>
    </div>
  );
}
