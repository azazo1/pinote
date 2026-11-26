#include <node_api.h>
#include <ApplicationServices/ApplicationServices.h>
#include <string.h>

// 在主进程里读取系统焦点元素的文本插入点, 让辅助功能授权直接作用于 Pinote,
// 而不是 helper 子进程. 未授权或读不到时返回 null.

static napi_value make_number(napi_env env, double value) {
    napi_value number;
    napi_create_double(env, value, &number);
    return number;
}

static void set_prop(napi_env env, napi_value object, const char *name, double value) {
    napi_set_named_property(env, object, name, make_number(env, value));
}

static napi_value get_caret_rect(napi_env env, napi_callback_info info) {
    napi_value null_value;
    napi_get_null(env, &null_value);

    AXUIElementRef system = AXUIElementCreateSystemWide();
    if (system == NULL) return null_value;
    CFTypeRef focused = NULL;
    CGRect rect;
    int found = 0;
    if (AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute, &focused) == kAXErrorSuccess && focused != NULL) {
        CFTypeRef range = NULL;
        if (AXUIElementCopyAttributeValue((AXUIElementRef)focused, kAXSelectedTextRangeAttribute, &range) == kAXErrorSuccess && range != NULL) {
            CFTypeRef bounds = NULL;
            if (AXUIElementCopyParameterizedAttributeValue((AXUIElementRef)focused, kAXBoundsForRangeParameterizedAttribute, range, &bounds) == kAXErrorSuccess && bounds != NULL) {
                if (AXValueGetValue((AXValueRef)bounds, kAXValueCGRectType, &rect)) {
                    found = rect.origin.x > -100000 && rect.origin.y > -100000 && rect.size.width >= 0 && rect.size.height >= 0;
                }
                CFRelease(bounds);
            }
            CFRelease(range);
        }
        CFRelease(focused);
    }
    CFRelease(system);
    if (!found) return null_value;

    napi_value object;
    napi_create_object(env, &object);
    set_prop(env, object, "x", rect.origin.x);
    set_prop(env, object, "y", rect.origin.y);
    set_prop(env, object, "width", rect.size.width);
    set_prop(env, object, "height", rect.size.height);
    return object;
}

static napi_value is_trusted(napi_env env, napi_callback_info info) {
    napi_value value;
    napi_get_boolean(env, AXIsProcessTrusted() ? true : false, &value);
    return value;
}

NAPI_MODULE_INIT() {
    napi_property_descriptor props[] = {
        { "getCaretRect", NULL, get_caret_rect, NULL, NULL, NULL, napi_default, NULL },
        { "isTrusted", NULL, is_trusted, NULL, NULL, NULL, napi_default, NULL },
    };
    napi_define_properties(env, exports, 2, props);
    return exports;
}
