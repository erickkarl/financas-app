// RF-001.9 / UX-004 / REV-35: a miniatura do app em "apps recentes" não pode mostrar dados.
// Android 13+: setRecentsScreenshotEnabled(false) — a lista de recentes não guarda imagem da tela (capturas de
// tela normais continuam possíveis). Android 7 a 12: FLAG_SECURE só enquanto o app sai de primeiro plano.
const { withMainActivity } = require('expo/config-plugins');

const MARK = '// financas: privacidade em apps recentes';
const IMPORTS = 'import android.view.WindowManager\n';
const ON_CREATE = `    ${MARK}
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false)
`;
const METHODS = `
  ${MARK} (Android 7 a 12)
  override fun onPause() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
  }
`;

function apply(src) {
  if (src.includes(MARK)) return src;
  let out = src.replace('import android.os.Bundle\n', `import android.os.Bundle\n${IMPORTS}`);
  out = out.replace(/(super\.onCreate\(null\)\n)/, `$1${ON_CREATE}`);
  out = out.replace(/(override fun getMainComponentName\(\))/, `${METHODS.trimStart()}\n  $1`);
  return out;
}

module.exports = function withRecentsPrivacy(config) {
  return withMainActivity(config, (c) => {
    c.modResults.contents = apply(c.modResults.contents);
    return c;
  });
};
module.exports.apply = apply;
