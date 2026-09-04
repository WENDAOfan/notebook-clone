package com.example.notebook_clone.common;
import lombok.Data;
/**
 * 统一返回结果类
 * 所有接口都返回这个格式，前端就能按固定格式解析了
 */
@Data//注解
public class Result<T> {

    private int code;      // 状态码：200=成功，400=失败
    private String message; // 提示信息
    private T data;         // 实际数据

    // 成功时调用
    public static <T> Result<T> success(T data) {
        Result<T> result = new Result<>();
        result.setCode(200);
        result.setMessage("操作成功");
        result.setData(data);
        return result;
    }

    // 失败时调用
    public static <T> Result<T> fail(String message) {
        Result<T> result = new Result<>();
        result.setCode(400);
        result.setMessage(message);
        result.setData(null);
        return result;
    }

}

