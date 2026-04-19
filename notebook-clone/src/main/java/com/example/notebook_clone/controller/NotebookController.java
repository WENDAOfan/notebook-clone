package com.example.notebook_clone.controller;

import com.example.notebook_clone.entity.Notebook;
import com.example.notebook_clone.repository.NotebookRepository;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.context.SecurityContextHolder;
import java.time.LocalDateTime;
import java.util.List;
import jakarta.validation.Valid;
import com.example.notebook_clone.common.Result;//返回值统一Result<T>
import com.example.notebook_clone.entity.User;           // ← 新增
import com.example.notebook_clone.repository.UserRepository; // ← 新增

// @Valid 的意思就是："在把请求体转成 Java 对象时，
// 顺便检查一下字段上的校验注解"。如果校验不通过，Spring 会自动拦截并返回错误。
@RestController
@RequestMapping("/api/notebooks") // 统一给这些接口加个前缀：/api/notebooks
public class NotebookController {

    // 把刚才建的“管家”请过来（依赖注入）
    private final NotebookRepository notebookRepository;
    private final UserRepository userRepository;  // ← 新增

    public NotebookController(NotebookRepository notebookRepository,UserRepository userRepository) {
        this.notebookRepository = notebookRepository;
        this.userRepository = userRepository; 
    }

    // 接口 1：查看所有笔记本 (GET 请求)
    @GetMapping
    public Result<List<Notebook>> getAllNotebooks() {
        // 直接调用管家的 findAll() 方法，连 SQL 都不用写！
        String username = SecurityContextHolder.getContext()//获取 Security 上下文
                .getAuthentication().getName();//获取当前认证信息，获取用户名
        // 2. 查询用户实体
        User currentUser = userRepository.findByUsername(username)//根据用户名查用户实体
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));        
        return Result.success(notebookRepository.findByUserId(currentUser.getId()));
    }

    // 接口 2：创建一个新笔记本 (POST 请求)
    @PostMapping
    public Result<Notebook> createNotebook(@Valid @RequestBody Notebook notebook) {
        
        // ===== Day 15：自动关联当前登录用户 =====
        // 1. 从 SecurityContext 获取当前登录用户名
        String username = SecurityContextHolder.getContext()//获取 Security 上下文
                .getAuthentication().getName();//获取当前认证信息，获取用户名
        
        // 2. 查询用户实体
        User currentUser = userRepository.findByUsername(username)//根据用户名查用户实体
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        
        // 3. 设置关联
        notebook.setUser(currentUser);
        // =========================================
        
        notebook.setCreateTime(LocalDateTime.now());
        return Result.success(notebookRepository.save(notebook));
    }

    // 接口 3：修改笔记本的名称或描述 (PUT 请求，专门用于修改)
    // 路径例如：/api/notebooks/1 (代表修改 ID 为 1 的笔记本)
    @PutMapping("/{id}")
    public Result<Notebook> updateNotebook(@PathVariable Long id, 
                                        @Valid @RequestBody Notebook updatedNotebook) {
        // Day 16 预告：这里还应该检查当前用户是否有权限修改这个笔记本！
        //获取当前用户
        String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
        User currentUser = userRepository.findByUsername(username)//根据用户名查用户实体
                .orElseThrow(() -> new RuntimeException("用户不存在: " + username));
        //查笔记本，同时校验
        Notebook existingNotebook = notebookRepository
                .findByIdAndUserId(id, currentUser.getId())
                .orElseThrow(() -> new RuntimeException("笔记本不存在或无权操作"));
                    
        // 3. 修改字段
        existingNotebook.setName(updatedNotebook.getName());
        existingNotebook.setDescription(updatedNotebook.getDescription());

        return Result.success(notebookRepository.save(existingNotebook));
    }

    // 接口 4：把整个笔记本扔进垃圾桶 (DELETE 请求)
    @DeleteMapping("/{id}")
    public Result<Void> deleteNotebook(@PathVariable Long id) {
        //获取当前用户
        String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();
        User currentUser = userRepository
            .findByUsername(username)
            .orElseThrow(()->new RuntimeException("用户不存在: " + username));
        // 2. 校验归属
        Boolean exists = notebookRepository.existsByIdAndUserId(id, currentUser.getId());
        if (!exists) {
        throw new RuntimeException("笔记本不存在或无权删除");
            }
        // 3. 校验通过，删除
        notebookRepository.deleteById(id);
        return Result.success(null);
        
    }
}
