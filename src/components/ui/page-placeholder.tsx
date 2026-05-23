type PagePlaceholderProps = {
  title: string;
  description: string;
};

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <section className="card pagePlaceholder">
      <p className="panelEyebrow">Раздел</p>
      <h2 className="pageTitle">{title}</h2>
      <p className="pageDescription">{description}</p>
      <div className="placeholderBox">
        <p className="placeholderTitle">Заглушка интерфейса</p>
        <p className="placeholderText">
          Здесь позже появится рабочий функционал раздела без изменения общего каркаса.
        </p>
      </div>
    </section>
  );
}
