import "@testing-library/jest-dom/vitest";
import i18n from "@/lib/i18n";

// 测试环境使用默认语言（简体中文），让组件里的 t() 返回真实文案而非键名
beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});
