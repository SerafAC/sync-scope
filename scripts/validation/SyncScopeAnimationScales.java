/** Read-only shell-process observation; never loaded into the application. */
public final class SyncScopeAnimationScales {
  public static void main(String[] args) throws Exception {
    Object service = Class.forName("android.view.WindowManagerGlobal")
        .getMethod("getWindowManagerService").invoke(null);
    float[] scales = (float[]) Class.forName("android.view.IWindowManager")
        .getMethod("getAnimationScales").invoke(service);
    if (scales == null || scales.length != 3) {
      throw new IllegalStateException("Missing animation scale observation");
    }
    for (float scale : scales) {
      if (!Float.isFinite(scale) || scale < 0) {
        throw new IllegalStateException("Invalid animation scale observation");
      }
      System.out.println(scale);
    }
  }
}
