cmake_minimum_required(VERSION 3.22.1)

project("ai-chat" VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED true)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED true)

set(CMAKE_C_FLAGS   "${CMAKE_C_FLAGS}"   CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}" CACHE STRING "" FORCE)

# --------------------------------------------------------------------------
# AI Chat library — JNI bridge over a vendored llama.cpp (see
# docs/adr/0015-native-llama-cpp-android-runtime.md). ai_chat.cpp and
# logging.h come from llama.cpp's own examples/llama.android sample
# (MIT-licensed), unmodified, so the JNI symbol names stay in sync with
# InferenceEngineImpl.kt's `external fun` declarations.
# --------------------------------------------------------------------------

if(DEFINED ANDROID_ABI)
    message(STATUS "Detected Android ABI: ${ANDROID_ABI}")
    if(ANDROID_ABI STREQUAL "arm64-v8a")
        set(GGML_SYSTEM_ARCH "ARM")
        # KleidiAI's CMake integration fetches its source over the network at configure time
        # (FetchContent), which real build environments (CI, offline dev machines) cannot rely
        # on. Plain CPU inference already benchmarks well without it — see
        # docs/adr/0015-native-llama-cpp-android-runtime.md.
        set(GGML_CPU_KLEIDIAI OFF)
        set(GGML_OPENMP ON)
    else()
        # 32-bit armeabi-v7a is deliberately unsupported: ggml's llamafile sgemm kernel needs
        # NEON FP16 intrinsics that this toolchain configuration doesn't expose for armv7, and
        # real-world Android devices from the last several years are effectively all arm64-v8a.
        message(FATAL_ERROR "Unsupported ABI: ${ANDROID_ABI} (only arm64-v8a is built)")
    endif()
endif()

set(LLAMA_SRC ${CMAKE_CURRENT_LIST_DIR}/llama.cpp)
# LLAMA_BUILD_COMMON defaults to LLAMA_STANDALONE, which is OFF once llama.cpp is pulled in via
# add_subdirectory() — without this, common/ (and the llama-common target ai_chat.cpp links
# against for sampling/chat-template/JSON-schema-grammar helpers) is never added at all.
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
add_subdirectory(${LLAMA_SRC} build-llama)

add_library(${CMAKE_PROJECT_NAME} SHARED
        ai_chat.cpp)

target_compile_definitions(${CMAKE_PROJECT_NAME} PRIVATE
        GGML_SYSTEM_ARCH=${GGML_SYSTEM_ARCH}
        GGML_CPU_KLEIDIAI=$<BOOL:${GGML_CPU_KLEIDIAI}>
        GGML_OPENMP=$<BOOL:${GGML_OPENMP}>
)

target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE
        ${LLAMA_SRC}
        ${LLAMA_SRC}/common
        ${LLAMA_SRC}/include
        ${LLAMA_SRC}/ggml/include
        ${LLAMA_SRC}/ggml/src
        ${LLAMA_SRC}/vendor)

target_link_libraries(${CMAKE_PROJECT_NAME}
        llama
        llama-common
        android
        log)
