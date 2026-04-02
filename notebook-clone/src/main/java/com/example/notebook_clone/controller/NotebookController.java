package com.example.notebook_clone.controller;

import com.example.notebook_clone.entity.Notebook;
import com.example.notebook_clone.repository.NotebookRepository;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import jakarta.validation.Valid;
import com.example.notebook_clone.common.Result;//返回值统一Result<T>
// @Valid 的意思就是："在把请求体转成 Java 对象时，
// 顺便检查一下字段上的校验注解"。如果校验不通过，Spring 会自动拦截并返回错误。
@RestController
@RequestMapping("/api/notebooks") // 统一给这些接口加个前缀：/api/notebooks
public class NotebookController {

    // 把刚才建的“管家”请过来（依赖注入）
    private final NotebookRepository notebookRepository;

    public NotebookController(NotebookRepository notebookRepository) {
        this.notebookRepository = notebookRepository;
    }

    // 接口 1：查看所有笔记本 (GET 请求)
    @GetMapping
    public Result<List<Notebook>> getAllNotebooks() {
        // 直接调用管家的 findAll() 方法，连 SQL 都不用写！
        return Result.success(notebookRepository.findAll());
    }

    // 接口 2：创建一个新笔记本 (POST 请求)
    @PostMapping
    public Result<Notebook> createNotebook(@Valid @RequestBody Notebook notebook) {
        // 设置一下当前的创建时间
        notebook.setCreateTime(LocalDateTime.now());
        // 调用管家的 save() 方法保存到数据库
        return Result.success(notebookRepository.save(notebook));
    }
    // 接口 3：修改笔记本的名称或描述 (PUT 请求，专门用于修改)
    // 路径例如：/api/notebooks/1 (代表修改 ID 为 1 的笔记本)
    @PutMapping("/{id}")
    public Result<Notebook> updateNotebook(@PathVariable Long id,@Valid @RequestBody Notebook updatedNotebook) {
        // 1. 先让管家去数据库里找找看，有没有这个 ID 的笔记本
        return notebookRepository.findById(id)
                .map(existingNotebook -> {
                    // 2. 如果找到了，就把传过来的新名字和新描述替换进去
                    existingNotebook.setName(updatedNotebook.getName());
                    existingNotebook.setDescription(updatedNotebook.getDescription());
                    // 3. 保存回数据库（因为 ID 没变，JPA 会自动执行 UPDATE 操作而不是新增）
                    return Result.success(notebookRepository.save(existingNotebook));
                })
                .orElseThrow(() -> new RuntimeException("修改失败：没找到 ID 为 " + id + " 的笔记本！"));
    }

    // 接口 4：把整个笔记本扔进垃圾桶 (DELETE 请求)
    @DeleteMapping("/{id}")
    public Result<Void> deleteNotebook(@PathVariable Long id) {
        if (notebookRepository.existsById(id)){
            // 直接让管家根据 ID 删掉它
            notebookRepository.deleteById(id);
            return Result.success(null);
        }else{
            // 不存在就告诉用户"找不到"
            return Result.fail("删除失败：没找到 ID 为 \" + id + \" 的笔记本！");
        }
        
    }
}
