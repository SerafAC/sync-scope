package com.syncscope.bridge

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import com.syncscope.media.SyncScopeVideoViewManager

/** Registers the CloudSync TurboModule and the `SyncScopeVideoView` native view with the React host. */
class CloudSyncPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == CloudSyncModule.NAME) CloudSyncModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      CloudSyncModule.NAME to
        ReactModuleInfo(
          name = CloudSyncModule.NAME,
          className = CloudSyncModule::class.java.name,
          canOverrideExistingModule = false,
          needsEagerInit = false,
          isCxxModule = false,
          isTurboModule = true,
        ),
    )
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<in Nothing, in Nothing>> =
    listOf(SyncScopeVideoViewManager())
}
